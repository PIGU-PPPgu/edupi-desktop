use std::{
    env::{self, var_os},
    path::{Path, PathBuf},
    sync::mpsc::Receiver,
};

use futures_lite::StreamExt;
use image::{RgbaImage, open};
use percent_encoding::percent_decode_str;
use serde::Deserialize;
use url::Url;
use xcb::{
    Connection as XcbConnection, Xid,
    randr::{GetMonitors, MonitorInfoBuf, Output},
    x::{Atom, InternAtom, ScreenBuf},
};
use zbus::{Connection as ZBusConnection, Proxy, Type};

use crate::{XCapError, error::XCapResult};

pub fn get_xcb_connection_and_index() -> XCapResult<(XcbConnection, i32)> {
    let display = env::var("DISPLAY").unwrap_or_else(|_| "DISPLAY:1".to_string());
    let (conn, idx) = XcbConnection::connect(Some(display.as_str()))
        .or_else(|_| XcbConnection::connect(None))
        .map_err(|e| XCapError::new(e.to_string()))?;
    Ok((conn, idx))
}

pub fn get_zbus_connection() -> XCapResult<ZBusConnection> {
    // zbus's tokio-multithread runtime is shared and continues driving connections
    // between synchronous xcap calls, including on the response-listener thread.
    zbus::block_on(ZBusConnection::session()).map_err(XCapError::ZbusError)
}

pub fn wayland_detect() -> bool {
    let xdg_session_type = var_os("XDG_SESSION_TYPE")
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    let wayland_display = var_os("WAYLAND_DISPLAY")
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    xdg_session_type.eq("wayland") || wayland_display.to_lowercase().contains("wayland")
}

pub fn get_current_screen_buf() -> XCapResult<ScreenBuf> {
    let (conn, index) = get_xcb_connection_and_index()?;

    let setup = conn.get_setup();

    let screen = setup
        .roots()
        .nth(index as usize)
        .ok_or_else(|| XCapError::new("Not found screen"))?;

    Ok(screen.to_owned())
}

pub fn get_monitor_info_buf(output: Output) -> XCapResult<MonitorInfoBuf> {
    let (conn, _) = get_xcb_connection_and_index()?;

    let screen_buf = get_current_screen_buf()?;

    let get_monitors_cookie = conn.send_request(&GetMonitors {
        window: screen_buf.root(),
        get_active: true,
    });

    let get_monitors_reply = conn.wait_for_reply(get_monitors_cookie)?;

    let monitor_info_iterator = get_monitors_reply.monitors();

    for monitor_info in monitor_info_iterator {
        for &item in monitor_info.outputs() {
            if item == output {
                return Ok(monitor_info.to_owned());
            }
        }
    }
    Err(XCapError::new("Not found monitor"))
}

pub fn get_atom(name: &str) -> XCapResult<Atom> {
    let (conn, _) = get_xcb_connection_and_index()?;
    let atom_cookie = conn.send_request(&InternAtom {
        only_if_exists: true,
        name: name.as_bytes(),
    });
    let atom_reply = conn.wait_for_reply(atom_cookie)?;
    let atom = atom_reply.atom();

    if atom.is_none() {
        return Err(XCapError::new(format!("{name} not supported")));
    }

    Ok(atom)
}

pub(super) fn png_to_rgba_image<T>(
    filename: T,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
) -> XCapResult<RgbaImage>
where
    T: AsRef<Path>,
{
    let mut dynamic_image = open(filename)?;
    dynamic_image = dynamic_image.crop(x as u32, y as u32, width as u32, height as u32);
    Ok(dynamic_image.to_rgba8())
}

/// uri 转换为 path
pub(super) fn safe_uri_to_path(uri: &str) -> XCapResult<PathBuf> {
    let url = Url::parse(uri)?;

    if url.scheme() != "file" {
        return Err(XCapError::new("Uri scheme is not file"));
    }

    // 获取已解码的路径
    let decoded_path = percent_decode_str(url.path())
        .decode_utf8_lossy()
        .to_string();

    let path = PathBuf::from(&decoded_path);

    Ok(path)
}

pub(super) fn get_zbus_portal_request(
    conn: &ZBusConnection,
    handle_token: &str,
) -> XCapResult<Proxy<'static>> {
    let unique_identifier = conn
        .unique_name()
        .ok_or(XCapError::new("Get DBus unique name failed"))?
        .trim_start_matches(':')
        .replace('.', "_");

    let path =
        format!("/org/freedesktop/portal/desktop/request/{unique_identifier}/{handle_token}");

    let request = zbus::block_on(Proxy::new(
        conn,
        "org.freedesktop.portal.Desktop",
        path,
        "org.freedesktop.portal.Request",
    ))?;

    Ok(request)
}

pub(super) fn wait_zbus_response<T>(request: &Proxy<'static>) -> XCapResult<Receiver<XCapResult<T>>>
where
    T: for<'de> Deserialize<'de> + Type + Send + Sync + 'static,
{
    let (sender, receiver) = std::sync::mpsc::channel();

    // Install the match before the portal method call; a fast response must not
    // race a background thread that has not subscribed yet.
    let response = zbus::block_on(request.receive_signal("Response"))?;
    std::thread::spawn(move || {
        let response = zbus::block_on(wait_zbus_response_inner::<T>(response));
        let _ = sender.send(response);
    });

    Ok(receiver)
}

async fn wait_zbus_response_inner<T>(mut response: zbus::proxy::SignalStream<'_>) -> XCapResult<T>
where
    T: for<'de> Deserialize<'de> + Type,
{
    let message = response
        .next()
        .await
        .ok_or(XCapError::new("Failed get response"))?;

    let body = message.body();
    let (code, _): (u32, std::collections::HashMap<String, zbus::OwnedVariant>) =
        body.deserialize()?;

    if code == 0 {
        let (_, results): (u32, T) = body.deserialize()?;
        return Ok(results);
    }

    if code == 1 {
        return Err(XCapError::new("Z-Bus canceled"));
    }

    Err(XCapError::new(format!("Response code is {code}")))
}

#[cfg(test)]
mod zbus6_tests {
    use super::*;
    use std::{collections::HashMap, time::Duration};
    use zbus::{DeserializeDict, OwnedVariant, Str};

    #[derive(Debug, DeserializeDict, Type)]
    #[zbus(signature = "dict")]
    struct PortalResult {
        uri: String,
    }

    #[test]
    fn zbus6_portal_success_cancel_and_failure() {
        assert_eq!(env::var("EDUPI_TEST_DBUS_ISOLATED").as_deref(), Ok("1"));
        let service = zbus::block_on(
            zbus::connection::Builder::session()
                .name("org.edupi.PortalTest")
                .build(),
        )
        .expect("private portal service");
        let client = get_zbus_connection().expect("private portal client");

        for code in [0u32, 1, 2] {
            let path = format!("/org/edupi/PortalTest/request_{code}");
            let request = zbus::block_on(Proxy::new(
                &client,
                "org.edupi.PortalTest",
                path.clone(),
                "org.freedesktop.portal.Request",
            ))
            .expect("request proxy");
            let receiver =
                wait_zbus_response::<PortalResult>(&request).expect("response subscription");
            // The shared runtime must keep the connection alive outside block_on.
            std::thread::sleep(Duration::from_millis(20));
            let results: HashMap<&str, OwnedVariant> = if code == 0 {
                [(
                    "uri",
                    OwnedVariant::from(Str::from("file:///tmp/edupi-portal-test.png")),
                )]
                .into()
            } else {
                HashMap::new()
            };
            zbus::block_on(service.emit_signal(
                None::<&str>,
                path.as_str(),
                "org.freedesktop.portal.Request",
                "Response",
                &(code, results),
            ))
            .expect("portal response signal");
            let result = receiver
                .recv_timeout(Duration::from_secs(5))
                .expect("bounded response");
            match code {
                0 => assert_eq!(
                    result.expect("success results").uri,
                    "file:///tmp/edupi-portal-test.png"
                ),
                1 => assert!(
                    result
                        .expect_err("cancel response")
                        .to_string()
                        .contains("canceled")
                ),
                2 => assert!(
                    result
                        .expect_err("failed response")
                        .to_string()
                        .contains("Response code is 2")
                ),
                _ => unreachable!(),
            }
        }
    }
}
