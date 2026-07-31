use std::path::{Path, PathBuf};
use std::time::Duration;

use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use serde_json::{json, Value};

const CONFIG_DIR: &str = ".cc-switch";
const DATABASE_FILE: &str = "cc-switch.db";

#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum CcSwitchConfigRead {
    Found { config: Value },
    NotInstalled,
    ReadFailed { detail: String },
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
}

fn read_failed(error: impl ToString) -> CcSwitchConfigRead {
    CcSwitchConfigRead::ReadFailed {
        detail: error.to_string(),
    }
}

fn read_database_at(path: &Path) -> CcSwitchConfigRead {
    match path.try_exists() {
        Ok(false) => return CcSwitchConfigRead::NotInstalled,
        Ok(true) => {}
        Err(error) => return read_failed(error),
    }

    let connection = match Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    ) {
        Ok(connection) => connection,
        Err(error) => return read_failed(error),
    };
    if let Err(error) = connection.busy_timeout(Duration::from_secs(2)) {
        return read_failed(error);
    }

    let mut statement = match connection.prepare(
        "SELECT app_type, name, settings_config
         FROM providers
         WHERE app_type IN ('claude', 'codex')
         ORDER BY app_type, sort_index, created_at",
    ) {
        Ok(statement) => statement,
        Err(error) => return read_failed(error),
    };
    let rows = match statement.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
        ))
    }) {
        Ok(rows) => rows,
        Err(error) => return read_failed(error),
    };

    let mut providers = Vec::new();
    for row in rows {
        let (app_type, name, settings_text) = match row {
            Ok(row) => row,
            Err(error) => return read_failed(error),
        };
        let settings_config: Value = match serde_json::from_str(&settings_text) {
            Ok(settings) => settings,
            Err(error) => {
                return read_failed(format!("invalid settings_config for {name}: {error}"));
            }
        };
        providers.push(json!({
            "appType": app_type,
            "name": name,
            "settingsConfig": settings_config,
        }));
    }

    CcSwitchConfigRead::Found {
        config: json!({ "providers": providers }),
    }
}

/// 直接读取 cc-switch 的默认数据库，不接受前端传入任意路径。
#[tauri::command]
pub fn cc_switch_read_config() -> CcSwitchConfigRead {
    let Some(home) = home_dir() else {
        return CcSwitchConfigRead::NotInstalled;
    };
    read_database_at(&home.join(CONFIG_DIR).join(DATABASE_FILE))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_database_is_reported_as_not_installed() {
        let path = std::env::temp_dir().join(format!(
            "spoor-cc-switch-missing-{}.db",
            uuid::Uuid::new_v4()
        ));

        assert!(matches!(
            read_database_at(&path),
            CcSwitchConfigRead::NotInstalled
        ));
    }

    #[test]
    fn providers_are_read_from_database() {
        let path =
            std::env::temp_dir().join(format!("spoor-cc-switch-{}.db", uuid::Uuid::new_v4()));
        let connection = Connection::open(&path).expect("create test database");
        connection
            .execute_batch(
                "CREATE TABLE providers (
                    app_type TEXT NOT NULL,
                    name TEXT NOT NULL,
                    settings_config TEXT NOT NULL,
                    sort_index INTEGER,
                    created_at INTEGER
                );",
            )
            .expect("create providers table");
        connection
            .execute(
                "INSERT INTO providers
                 (app_type, name, settings_config, sort_index, created_at)
                 VALUES (?1, ?2, ?3, 0, 0)",
                (
                    "claude",
                    "Test Relay",
                    r#"{"env":{"ANTHROPIC_AUTH_TOKEN":"sk-test"}}"#,
                ),
            )
            .expect("insert test provider");
        drop(connection);

        let result = read_database_at(&path);
        let _ = std::fs::remove_file(&path);

        let CcSwitchConfigRead::Found { config } = result else {
            panic!("expected database contents");
        };
        assert_eq!(config["providers"][0]["appType"], "claude");
        assert_eq!(config["providers"][0]["name"], "Test Relay");
        assert_eq!(
            config["providers"][0]["settingsConfig"]["env"]["ANTHROPIC_AUTH_TOKEN"],
            "sk-test"
        );
    }
}
