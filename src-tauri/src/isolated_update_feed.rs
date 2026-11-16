use tauri::Url;

pub const ENV: &str = "EDUPI_ISOLATED_UPDATE_FEED";

/// Only immutable, first-party manifests may be used by an isolated acceptance run.
/// Keep this contract paired with lib/isolated-update-feed.ts.
pub fn from_inputs(marker: Option<&str>, value: Option<&str>) -> Result<Option<Url>, &'static str> {
    let Some(value) = value else { return Ok(None) };
    if marker != Some("1") {
        return Err("isolated updates require the explicit canary marker");
    }
    let url = Url::parse(value).map_err(|_| "invalid isolated update feed")?;
    let parts: Vec<_> = url.path().split('/').collect();
    let valid_path = parts.len() == 8
        && parts[0].is_empty()
        && parts[1] == "PIGU-PPPgu"
        && parts[2] == "edupi-desktop"
        && parts[3].len() == 40
        && parts[3]
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
        && parts[4..7] == ["docs", "acceptance", "update-cohorts"]
        && parts[7].strip_suffix(".json").is_some_and(|name| {
            !name.is_empty()
                && name.len() <= 64
                && name.as_bytes()[0].is_ascii_alphanumeric()
                && name
                    .bytes()
                    .all(|c| c.is_ascii_digit() || c.is_ascii_lowercase() || c == b'-')
        });
    if url.scheme() != "https"
        || url.host_str() != Some("raw.githubusercontent.com")
        || url.port().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.as_str() != value
        || !valid_path
    {
        return Err("invalid isolated update feed");
    }
    Ok(Some(url))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn feed() -> String {
        format!("https://raw.githubusercontent.com/PIGU-PPPgu/edupi-desktop/{}/docs/acceptance/update-cohorts/macos-116-117.json", "a".repeat(40))
    }

    #[test]
    fn normal_launch_has_no_override_and_marker_is_required() {
        assert!(from_inputs(None, None).unwrap().is_none());
        assert!(from_inputs(Some("1"), None).unwrap().is_none());
        assert!(from_inputs(None, Some(&feed())).is_err());
        assert!(from_inputs(Some("0"), Some(&feed())).is_err());
        assert_eq!(
            from_inputs(Some("1"), Some(&feed()))
                .unwrap()
                .unwrap()
                .as_str(),
            feed()
        );
    }

    #[test]
    fn rejects_mutable_foreign_insecure_or_noncanonical_feeds() {
        let valid = feed();
        for value in [
            valid.replace("https:", "http:"),
            valid.replace(&"a".repeat(40), "main"),
            valid.replace("raw.githubusercontent.com", "example.com"),
            valid.replace("PIGU-PPPgu", "other"),
            format!("{valid}?token=secret"),
            format!("{valid}#fragment"),
            valid.replace("https://", "https://user@"),
            valid.replace(".com/", ".com:8443/"),
            valid.replace("/update-cohorts/", "/other/"),
            valid.replace("/docs/", "/ignored/../docs/"),
        ] {
            assert!(from_inputs(Some("1"), Some(&value)).is_err(), "{value}");
        }
    }
}
