// Copyright 2019-2023 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

#[cfg(feature = "semver")]
use crate::semver_compat::semver_compat_string;

use crate::SingleInstanceCallback;
use tauri::{
    plugin::{self, TauriPlugin},
    Manager, RunEvent, Runtime,
};
use zbus::{interface, names::WellKnownName, Connection};

struct ConnectionHandle(Connection);

struct SingleInstanceDBus {
    callback: Box<dyn FnMut(Vec<String>, String) + Send + Sync>,
}

#[interface(name = "org.SingleInstance.DBus")]
impl SingleInstanceDBus {
    fn execute_callback(&mut self, argv: Vec<String>, cwd: String) {
        (self.callback)(argv, cwd);
    }
}

async fn claim_name(
    dbus_name: &str,
    dbus_path: &str,
    service: SingleInstanceDBus,
) -> zbus::Result<Connection> {
    zbus::connection::Builder::session()
        .name(dbus_name)
        .replace_existing_names(false)
        .allow_name_replacements(false)
        .serve_at(dbus_path, service)
        .build()
        .await
}

struct DBusName(String);

pub fn init<R: Runtime>(
    mut callback: Box<SingleInstanceCallback<R>>,
    dbus_id: Option<String>,
) -> TauriPlugin<R> {
    plugin::Builder::new("single-instance")
        .setup(move |app, _api| {
            let mut dbus_name = dbus_id.unwrap_or_else(|| app.config().identifier.clone());
            dbus_name.push_str(".SingleInstance");

            #[cfg(feature = "semver")]
            {
                dbus_name.push('_');
                dbus_name.push_str(semver_compat_string(&app.package_info().version).as_str());
            }

            let mut dbus_path = dbus_name.replace('.', "/").replace('-', "_");
            if !dbus_path.starts_with('/') {
                dbus_path = format!("/{dbus_path}");
            }

            let app_handle = app.clone();
            let single_instance_dbus = SingleInstanceDBus {
                callback: Box::new(move |argv, cwd| callback(&app_handle, argv, cwd)),
            };

            // Tauri's global Tokio runtime keeps driving the service after setup returns.
            match tauri::async_runtime::block_on(claim_name(
                dbus_name.as_str(),
                dbus_path.as_str(),
                single_instance_dbus,
            )) {
                Ok(connection) => {
                    app.manage(ConnectionHandle(connection));
                }
                Err(zbus::Error::NameTaken) => {
                    tauri::async_runtime::block_on(async {
                        if let Ok(connection) = Connection::session().await {
                            let _ = connection
                                .call_method(
                                    Some(dbus_name.as_str()),
                                    dbus_path.as_str(),
                                    Some("org.SingleInstance.DBus"),
                                    "ExecuteCallback",
                                    &(
                                        std::env::args().collect::<Vec<String>>(),
                                        std::env::current_dir()
                                            .unwrap_or_default()
                                            .to_str()
                                            .unwrap_or_default(),
                                    ),
                                )
                                .await;
                        }
                    });
                    app.cleanup_before_exit();
                    std::process::exit(0);
                }
                _ => {}
            }

            app.manage(DBusName(dbus_name));

            Ok(())
        })
        .on_event(move |app, event| {
            if let RunEvent::Exit = event {
                destroy(app);
            }
        })
        .build()
}

pub fn destroy<R: Runtime, M: Manager<R>>(manager: &M) {
    if let Some(connection) = manager.try_state::<ConnectionHandle>() {
        if let Some(dbus_name) = manager
            .try_state::<DBusName>()
            .and_then(|name| WellKnownName::try_from(name.0.clone()).ok())
        {
            let _ = tauri::async_runtime::block_on(connection.0.release_name(dbus_name));
        }
    }
}

#[cfg(test)]
mod zbus6_tests {
    use super::*;
    use std::{sync::mpsc, time::Duration};

    #[test]
    fn zbus6_single_instance_callback_and_name_release() {
        assert_eq!(
            std::env::var("EDUPI_TEST_DBUS_ISOLATED").as_deref(),
            Ok("1")
        );
        let name = format!("org.edupi.SingleInstanceTest.p{}", std::process::id());
        let path = "/org/edupi/SingleInstanceTest";
        let (sender, receiver) = mpsc::channel();
        let mut invocations = 0;
        let first = tauri::async_runtime::block_on(claim_name(
            &name,
            path,
            SingleInstanceDBus {
                callback: Box::new(move |args, cwd| {
                    invocations += 1;
                    sender.send((invocations, args, cwd)).unwrap();
                }),
            },
        ))
        .expect("first instance owns name");
        let duplicate = tauri::async_runtime::block_on(claim_name(
            &name,
            path,
            SingleInstanceDBus {
                callback: Box::new(|_, _| panic!("second instance must not receive callback")),
            },
        ));
        assert!(matches!(duplicate, Err(zbus::Error::NameTaken)));

        // Setup has returned: only Tauri's persistent runtime drives the service.
        std::thread::sleep(Duration::from_millis(20));
        tauri::async_runtime::block_on(async {
            let second = Connection::session()
                .await
                .expect("second instance connection");
            for _ in 0..2 {
                second
                    .call_method(
                        Some(name.as_str()),
                        path,
                        Some("org.SingleInstance.DBus"),
                        "ExecuteCallback",
                        &(
                            vec!["edupi".to_owned(), "--test".to_owned()],
                            "/tmp/edupi-single-instance-test",
                        ),
                    )
                    .await
                    .expect("callback RPC");
            }
        });
        for expected_invocations in 1..=2 {
            assert_eq!(
                receiver
                    .recv_timeout(Duration::from_secs(5))
                    .expect("callback delivered"),
                (
                    expected_invocations,
                    vec!["edupi".to_owned(), "--test".to_owned()],
                    "/tmp/edupi-single-instance-test".to_owned()
                )
            );
        }
        assert!(
            tauri::async_runtime::block_on(first.release_name(name.as_str()))
                .expect("release name")
        );
        let _replacement = tauri::async_runtime::block_on(claim_name(
            &name,
            path,
            SingleInstanceDBus {
                callback: Box::new(|_, _| {}),
            },
        ))
        .expect("name can be claimed after release");
    }
}
