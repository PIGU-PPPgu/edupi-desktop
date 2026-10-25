// Copyright 2026 EduPi contributors
// SPDX-License-Identifier: Apache-2.0

//! Private replacement for the channels removed in GLib 0.19.
//! See https://gtk-rs.org/blog/2024/06/01/new-release.html#removal-of-glib-channels

use gtk::glib::{ControlFlow, MainContext, Priority};
use std::sync::mpsc::SendError;

pub(crate) struct Sender<T>(async_channel::Sender<T>);

// Do not require T: Clone: a sender clones the queue handle, not its messages.
impl<T> Clone for Sender<T> {
  fn clone(&self) -> Self {
    Self(self.0.clone())
  }
}

impl<T> Sender<T> {
  pub(crate) fn send(&self, value: T) -> Result<(), SendError<T>> {
    self
      .0
      .try_send(value)
      .map_err(|err| SendError(err.into_inner()))
  }
}

pub(crate) struct Receiver<T> {
  inner: async_channel::Receiver<T>,
  priority: Priority,
}

pub(crate) fn channel<T>(priority: Priority) -> (Sender<T>, Receiver<T>) {
  let (sender, receiver) = async_channel::unbounded();
  (
    Sender(sender),
    Receiver {
      inner: receiver,
      priority,
    },
  )
}

impl<T: 'static> Receiver<T> {
  pub(crate) fn attach<F>(self, context: Option<&MainContext>, mut callback: F)
  where
    F: FnMut(T) -> ControlFlow + 'static,
  {
    let context = context.cloned().unwrap_or_else(MainContext::default);
    // Dropping GLib's JoinHandle detaches the task; the context owns it until completion.
    drop(
      context.spawn_local_with_priority(self.priority, async move {
        while let Ok(value) = self.inner.recv().await {
          if matches!(callback(value), ControlFlow::Break) {
            break;
          }
        }
      }),
    );
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::{
    cell::{Cell, RefCell},
    rc::Rc,
    time::{Duration, Instant},
  };

  struct NotClone(u32);

  fn dispatch_until(context: &MainContext, condition: impl Fn() -> bool) {
    let started = Instant::now();
    while !condition() {
      assert!(
        started.elapsed() < Duration::from_secs(5),
        "channel did not settle"
      );
      context.iteration(false);
      std::thread::yield_now();
    }
  }

  #[test]
  fn cross_thread_messages_keep_fifo_and_dispatch_on_context_thread() {
    let context = MainContext::new();
    let received = Rc::new(RefCell::new(Vec::new()));
    let values = received.clone();
    let owner = std::thread::current().id();
    let (sender, receiver) = channel::<NotClone>(Priority::DEFAULT);
    let second_sender = sender.clone();
    sender.send(NotClone(0)).unwrap();
    drop(sender);
    std::thread::spawn(move || {
      second_sender.send(NotClone(1)).unwrap();
      second_sender.send(NotClone(2)).unwrap();
    })
    .join()
    .unwrap();

    receiver.attach(Some(&context), move |value| {
      assert_eq!(std::thread::current().id(), owner);
      values.borrow_mut().push(value.0);
      ControlFlow::Continue
    });
    dispatch_until(&context, || received.borrow().len() == 3);
    assert_eq!(*received.borrow(), vec![0, 1, 2]);
  }

  #[test]
  fn break_stops_dispatch_and_closes_senders() {
    let context = MainContext::new();
    let called = Rc::new(Cell::new(0));
    let count = called.clone();
    let (sender, receiver) = channel::<NotClone>(Priority::DEFAULT);
    receiver.attach(Some(&context), move |_| {
      count.set(count.get() + 1);
      ControlFlow::Break
    });
    sender.send(NotClone(0)).unwrap();
    sender.send(NotClone(1)).unwrap();
    dispatch_until(&context, || called.get() == 1);
    assert_eq!(sender.send(NotClone(2)).unwrap_err().0 .0, 2);
    while context.pending() {
      context.iteration(false);
    }
    assert_eq!(called.get(), 1);
  }

  #[test]
  fn dropping_receiver_returns_unsent_value() {
    let (sender, receiver) = channel::<NotClone>(Priority::DEFAULT);
    drop(receiver);
    assert_eq!(sender.send(NotClone(7)).unwrap_err().0 .0, 7);
  }

  #[test]
  fn dropping_all_senders_releases_callback() {
    struct Dropped(Rc<Cell<bool>>);
    impl Drop for Dropped {
      fn drop(&mut self) {
        self.0.set(true);
      }
    }

    let context = MainContext::new();
    let dropped = Rc::new(Cell::new(false));
    let guard = Dropped(dropped.clone());
    let (sender, receiver) = channel::<NotClone>(Priority::DEFAULT);
    receiver.attach(Some(&context), move |_| {
      let _guard = &guard;
      ControlFlow::Continue
    });
    context.iteration(false);
    assert!(!dropped.get());
    drop(sender);
    dispatch_until(&context, || dropped.get());
  }

  #[test]
  fn requested_priority_is_preserved() {
    let context = MainContext::new();
    let received = Rc::new(RefCell::new(Vec::new()));
    for (priority, value) in [(Priority::DEFAULT, 0), (Priority::HIGH, 1)] {
      let values = received.clone();
      let (sender, receiver) = channel(priority);
      receiver.attach(Some(&context), move |value| {
        values.borrow_mut().push(value);
        ControlFlow::Break
      });
      sender.send(value).unwrap();
    }
    dispatch_until(&context, || received.borrow().len() == 2);
    assert_eq!(*received.borrow(), vec![1, 0]);
  }
}
