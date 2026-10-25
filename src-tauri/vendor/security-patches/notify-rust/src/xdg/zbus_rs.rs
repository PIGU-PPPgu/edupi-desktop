use crate::{error::*, notification::Notification, xdg};
use futures_lite::stream::StreamExt;
use zbus::MatchRule;

use super::{bus::NotificationBus, ActionResponse, ActionResponseHandler, CloseReason};

pub mod bus {

    use crate::xdg::NOTIFICATION_DEFAULT_BUS;

    fn skip_first_slash(s: &str) -> &str {
        if let Some('/') = s.chars().next() {
            &s[1..]
        } else {
            s
        }
    }

    use std::path::PathBuf;

    type BusNameType = zbus::names::WellKnownName<'static>;

    #[derive(Clone, Debug)]
    pub struct NotificationBus(BusNameType);

    impl Default for NotificationBus {
        #[cfg(feature = "zbus")]
        fn default() -> Self {
            Self(zbus::names::WellKnownName::from_static_str(NOTIFICATION_DEFAULT_BUS).unwrap())
        }
    }

    impl NotificationBus {
        fn namespaced_custom(custom_path: &str) -> Option<String> {
            // abusing path for semantic join
            skip_first_slash(
                PathBuf::from("/de/hoodie/Notification")
                    .join(custom_path)
                    .to_str()?,
            )
            .replace('/', ".")
            .into()
        }

        pub fn custom(custom_path: &str) -> Option<Self> {
            let name =
                zbus::names::WellKnownName::try_from(Self::namespaced_custom(custom_path)?).ok()?;
            Some(Self(name))
        }

        pub fn into_name(self) -> BusNameType {
            self.0
        }
    }
}

/// A handle to a shown notification.
///
/// This keeps a connection alive to ensure actions work on certain desktops.
#[derive(Debug)]
pub struct ZbusNotificationHandle {
    pub(crate) id: u32,
    pub(crate) connection: zbus::Connection,
    pub(crate) notification: Notification,
}

impl ZbusNotificationHandle {
    pub(crate) fn new(
        id: u32,
        connection: zbus::Connection,
        notification: Notification,
    ) -> ZbusNotificationHandle {
        ZbusNotificationHandle {
            id,
            connection,
            notification,
        }
    }

    pub async fn wait_for_action(&self, invocation_closure: impl ActionResponseHandler) {
        wait_for_action_signal(&self.connection, self.id, invocation_closure).await;
    }

    pub(super) fn wait_for_action_sync(&self, handler: impl ActionResponseHandler) {
        if let Some(response) = super::block_on(wait_for_action_response(&self.connection, self.id))
        {
            // Keep user callbacks on their calling thread. They may borrow local,
            // non-Send state; only the D-Bus wait crosses the scoped thread.
            handler.call(&response.as_response());
        }
    }

    pub async fn close_fallible(&self) -> Result<()> {
        self.connection
            .call_method(
                Some(self.notification.bus.clone().into_name()),
                xdg::NOTIFICATION_OBJECTPATH,
                Some(xdg::NOTIFICATION_INTERFACE),
                "CloseNotification",
                &(self.id),
            )
            .await?;
        Ok(())
    }

    pub async fn close(&self) {
        let _ = self.close_fallible().await;
    }

    pub fn on_close<F>(self, closure: F)
    where
        F: FnOnce(CloseReason),
    {
        self.wait_for_action_sync(|action: &ActionResponse| {
            if let ActionResponse::Closed(reason) = action {
                closure(*reason);
            }
        });
    }

    pub fn update_fallible(&mut self) -> Result<()> {
        self.id = super::block_on(send_notification_via_connection(
            &self.notification,
            self.id,
            &self.connection,
        ))?;
        Ok(())
    }

    pub fn update(&mut self) -> Result<()> {
        self.update_fallible()
    }
}

async fn send_notification_via_connection(
    notification: &Notification,
    id: u32,
    connection: &zbus::Connection,
) -> Result<u32> {
    send_notification_via_connection_at_bus(notification, id, connection, Default::default()).await
}

async fn send_notification_via_connection_at_bus(
    notification: &Notification,
    id: u32,
    connection: &zbus::Connection,
    bus: NotificationBus,
) -> Result<u32> {
    let reply: u32 = connection
        .call_method(
            Some(bus.into_name()),
            xdg::NOTIFICATION_OBJECTPATH,
            Some(xdg::NOTIFICATION_INTERFACE),
            "Notify",
            &(
                &notification.appname,
                id,
                &notification.icon,
                &notification.summary,
                &notification.body,
                &notification.actions,
                crate::hints::hints_to_map(notification),
                i32::from(notification.timeout),
            ),
        )
        .await?
        .body()
        .deserialize()?;
    Ok(reply)
}

pub async fn connect_and_send_notification(
    notification: &Notification,
) -> Result<ZbusNotificationHandle> {
    let bus = notification.bus.clone();
    connect_and_send_notification_at_bus(notification, bus).await
}

pub(crate) async fn connect_and_send_notification_at_bus(
    notification: &Notification,
    bus: NotificationBus,
) -> Result<ZbusNotificationHandle> {
    let connection = zbus::Connection::session().await?;
    let inner_id = notification.id.unwrap_or(0);
    let id =
        send_notification_via_connection_at_bus(notification, inner_id, &connection, bus).await?;

    Ok(ZbusNotificationHandle::new(
        id,
        connection,
        notification.clone(),
    ))
}

pub async fn get_capabilities_at_bus(bus: NotificationBus) -> Result<Vec<String>> {
    let connection = zbus::Connection::session().await?;
    let info: Vec<String> = connection
        .call_method(
            Some(bus.into_name()),
            xdg::NOTIFICATION_OBJECTPATH,
            Some(xdg::NOTIFICATION_INTERFACE),
            "GetCapabilities",
            &(),
        )
        .await?
        .body()
        .deserialize()?;
    Ok(info)
}

pub async fn get_capabilities() -> Result<Vec<String>> {
    get_capabilities_at_bus(Default::default()).await
}

pub async fn get_server_information_at_bus(bus: NotificationBus) -> Result<xdg::ServerInformation> {
    let connection = zbus::Connection::session().await?;
    let info: xdg::ServerInformation = connection
        .call_method(
            Some(bus.into_name()),
            xdg::NOTIFICATION_OBJECTPATH,
            Some(xdg::NOTIFICATION_INTERFACE),
            "GetServerInformation",
            &(),
        )
        .await?
        .body()
        .deserialize()?;

    Ok(info)
}

pub async fn get_server_information() -> Result<xdg::ServerInformation> {
    get_server_information_at_bus(Default::default()).await
}

/// Listens for the `ActionInvoked(UInt32, String)` Signal.
///
/// No need to use this, check out `Notification::show_and_wait_for_action(FnOnce(action:&str))`
pub(super) fn handle_action_sync(id: u32, handler: impl ActionResponseHandler) {
    let response = super::block_on(async {
        let connection = zbus::Connection::session().await.unwrap();
        wait_for_action_response(&connection, id).await
    });
    if let Some(response) = response {
        handler.call(&response.as_response());
    }
}

enum OwnedActionResponse {
    Custom(String),
    Closed(CloseReason),
}

impl OwnedActionResponse {
    fn as_response(&self) -> ActionResponse<'_> {
        match self {
            Self::Custom(action) => ActionResponse::Custom(action),
            Self::Closed(reason) => ActionResponse::Closed(*reason),
        }
    }
}

async fn wait_for_action_signal(
    connection: &zbus::Connection,
    id: u32,
    handler: impl ActionResponseHandler,
) {
    if let Some(response) = wait_for_action_response(connection, id).await {
        handler.call(&response.as_response());
    }
}

async fn wait_for_action_response(
    connection: &zbus::Connection,
    id: u32,
) -> Option<OwnedActionResponse> {
    let action_signal_rule = MatchRule::builder()
        .msg_type(zbus::message::Type::Signal)
        .interface(xdg::NOTIFICATION_INTERFACE)
        .member("ActionInvoked")
        .build()
        .expect("valid notification action match rule");

    let proxy = zbus::fdo::DBusProxy::new(connection).await.unwrap();
    proxy.add_match_rule(action_signal_rule).await.unwrap();

    let close_signal_rule = MatchRule::builder()
        .msg_type(zbus::message::Type::Signal)
        .interface(xdg::NOTIFICATION_INTERFACE)
        .member("NotificationClosed")
        .build()
        .expect("valid notification close match rule");
    proxy.add_match_rule(close_signal_rule).await.unwrap();

    while let Ok(Some(msg)) = zbus::MessageStream::from(connection).try_next().await {
        let header = msg.header();
        if let zbus::message::Type::Signal = header.message_type() {
            match header.member() {
                Some(name) if name == "ActionInvoked" => {
                    match msg.body().deserialize::<(u32, String)>() {
                        Ok((nid, action)) if nid == id => {
                            return Some(OwnedActionResponse::Custom(action));
                        }
                        _ => {}
                    }
                }
                Some(name) if name == "NotificationClosed" => {
                    match msg.body().deserialize::<(u32, u32)>() {
                        Ok((nid, reason)) if nid == id => {
                            return Some(OwnedActionResponse::Closed(reason.into()));
                        }
                        _ => {}
                    }
                }
                _ => {}
            }
        }
    }
    None
}

#[cfg(test)]
mod zbus6_tests {
    use super::*;
    use std::{
        collections::HashMap,
        sync::{mpsc, Arc, Mutex},
        time::Duration,
    };

    #[derive(Clone, Default)]
    struct Calls(Arc<Mutex<Vec<String>>>);

    struct Notifications(Calls);

    // Both tests intentionally exercise the public default notification bus.
    static TEST_BUS: Mutex<()> = Mutex::new(());

    #[zbus::interface(name = "org.freedesktop.Notifications")]
    impl Notifications {
        #[allow(clippy::too_many_arguments)]
        fn notify(
            &mut self,
            _app_name: String,
            replaces_id: u32,
            _app_icon: String,
            summary: String,
            _body: String,
            _actions: Vec<String>,
            hints: HashMap<String, zbus::OwnedVariant>,
            _timeout: i32,
        ) -> u32 {
            assert!(hints.contains_key("urgency"));
            self.0
                 .0
                .lock()
                .unwrap()
                .push(format!("notify:{replaces_id}:{summary}"));
            7
        }

        fn close_notification(&mut self, id: u32) {
            self.0 .0.lock().unwrap().push(format!("close:{id}"));
        }
    }

    #[test]
    fn zbus6_notification_update_action_and_close() {
        let _test_bus = TEST_BUS.lock().unwrap();
        assert_eq!(
            std::env::var("EDUPI_TEST_DBUS_ISOLATED").as_deref(),
            Ok("1")
        );
        let calls = Calls::default();
        let service = zbus::block_on(
            zbus::connection::Builder::session()
                .name(xdg::NOTIFICATION_DEFAULT_BUS)
                .serve_at(xdg::NOTIFICATION_OBJECTPATH, Notifications(calls.clone()))
                .build(),
        )
        .expect("private notification service");
        let mut notification = Notification::new();
        notification
            .summary("initial")
            .urgency(crate::Urgency::Normal);
        let mut handle =
            zbus::block_on(connect_and_send_notification(&notification)).expect("notify");
        assert_eq!(handle.id, 7);

        std::thread::sleep(Duration::from_millis(20));
        handle.notification.summary("updated");
        handle
            .update_fallible()
            .expect("update through retained connection");
        let (sender, receiver) = mpsc::channel();
        let connection = handle.connection.clone();
        let waiter = std::thread::spawn(move || {
            zbus::block_on(wait_for_action_signal(
                &connection,
                7,
                move |action: &ActionResponse| {
                    if let ActionResponse::Custom(action) = action {
                        sender.send(action.to_string()).unwrap();
                    }
                },
            ));
        });
        let mut action = None;
        for _ in 0..100 {
            zbus::block_on(service.emit_signal(
                None::<&str>,
                xdg::NOTIFICATION_OBJECTPATH,
                xdg::NOTIFICATION_INTERFACE,
                "ActionInvoked",
                &(7u32, "open"),
            ))
            .expect("action signal");
            if let Ok(received) = receiver.recv_timeout(Duration::from_millis(20)) {
                action = Some(received);
                break;
            }
        }
        assert_eq!(action.as_deref(), Some("open"));
        waiter.join().unwrap();
        zbus::block_on(handle.close_fallible()).expect("close");
        assert_eq!(
            *calls.0.lock().unwrap(),
            ["notify:0:initial", "notify:7:updated", "close:7"]
        );
        zbus::block_on(service.release_name(xdg::NOTIFICATION_DEFAULT_BUS))
            .expect("release test bus");
    }

    #[test]
    fn zbus6_notification_sync_api_inside_tokio_task() {
        let _test_bus = TEST_BUS.lock().unwrap();
        assert_eq!(
            std::env::var("EDUPI_TEST_DBUS_ISOLATED").as_deref(),
            Ok("1")
        );
        let calls = Calls::default();
        let service = super::super::block_on(
            zbus::connection::Builder::session()
                .name(xdg::NOTIFICATION_DEFAULT_BUS)
                .serve_at(xdg::NOTIFICATION_OBJECTPATH, Notifications(calls.clone()))
                .build(),
        )
        .expect("private notification service");

        // The current-thread case also detects a connection accidentally bound
        // to the blocked caller runtime rather than zbus's background workers.
        for multithread in [false, true] {
            let mut builder = if multithread {
                let mut builder = tokio::runtime::Builder::new_multi_thread();
                builder.worker_threads(1);
                builder
            } else {
                tokio::runtime::Builder::new_current_thread()
            };
            let runtime = builder.enable_all().build().expect("caller Tokio runtime");
            runtime.block_on(async {
                tokio::spawn(async {
                    let mut notification = Notification::new();
                    notification
                        .summary("inside-task")
                        .urgency(crate::Urgency::Normal);
                    let mut handle = notification
                        .show()
                        .expect("synchronous show inside Tokio task");
                    assert_eq!(handle.id(), 7);
                    handle.summary("updated-task");
                    handle
                        .update()
                        .expect("synchronous update inside Tokio task");
                    handle.close();
                })
                .await
                .expect("Tokio task completes without a nested runtime panic");
            });
        }
        assert_eq!(
            *calls.0.lock().unwrap(),
            [
                "notify:0:inside-task",
                "notify:7:updated-task",
                "close:7",
                "notify:0:inside-task",
                "notify:7:updated-task",
                "close:7",
            ]
        );
        super::super::block_on(service.release_name(xdg::NOTIFICATION_DEFAULT_BUS))
            .expect("release test bus");
    }
}
