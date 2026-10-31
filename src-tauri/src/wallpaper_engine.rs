use crate::logger::{app_error, app_warn};
use crate::scanner::{self, WallpaperEntry};
use serde::Deserialize;
use std::collections::HashMap;
use std::fs;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;
use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
use windows_sys::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
use windows_sys::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_SZ};

const EXECUTABLES: &[&str] = &["wallpaper64.exe", "wallpaper32.exe"];
const WORKSHOP_APP_ID: &str = "431960";
const PREVIEW_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "webp", "gif"];
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const STARTUP_POLLS: u32 = 40;
const STARTUP_POLL_INTERVAL: Duration = Duration::from_millis(250);
const STARTUP_SETTLE: Duration = Duration::from_secs(2);

#[derive(Debug, Deserialize)]
struct ProjectManifest {
    title: Option<String>,
    preview: Option<String>,
    #[serde(rename = "type")]
    kind: Option<String>,
}

#[derive(Debug)]
struct Project {
    file: String,
    preview: PathBuf,
    title: String,
    kind: Option<String>,
}

fn to_wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

fn steam_directory() -> Option<PathBuf> {
    let subkey = to_wide(r"Software\Valve\Steam");
    let value = to_wide("SteamPath");
    let mut buffer = [0u16; 1024];
    let mut size = std::mem::size_of_val(&buffer) as u32;

    let status = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            subkey.as_ptr(),
            value.as_ptr(),
            RRF_RT_REG_SZ,
            std::ptr::null_mut(),
            buffer.as_mut_ptr() as *mut core::ffi::c_void,
            &mut size,
        )
    };
    if status != 0 {
        return None;
    }

    let len = buffer.iter().position(|c| *c == 0).unwrap_or(buffer.len());
    Some(PathBuf::from(String::from_utf16_lossy(&buffer[..len])))
}

fn parse_library_paths(vdf: &str) -> Vec<PathBuf> {
    vdf.lines()
        .filter_map(|line| {
            let parts: Vec<&str> = line.split('"').collect();
            if parts.len() >= 4 && parts[1] == "path" {
                Some(PathBuf::from(parts[3].replace(r"\\", r"\")))
            } else {
                None
            }
        })
        .collect()
}

fn steam_libraries() -> Vec<PathBuf> {
    let steam =
        steam_directory().unwrap_or_else(|| PathBuf::from(r"C:\Program Files (x86)\Steam"));
    let mut libraries = vec![steam.clone()];
    if let Ok(vdf) = fs::read_to_string(steam.join(r"steamapps\libraryfolders.vdf")) {
        libraries.extend(parse_library_paths(&vdf));
    }
    libraries
}

fn running_executable() -> Option<&'static str> {
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snapshot == INVALID_HANDLE_VALUE {
            return None;
        }

        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;

        let mut found = None;
        let mut has_entry = Process32FirstW(snapshot, &mut entry) != 0;
        while has_entry {
            let len = entry
                .szExeFile
                .iter()
                .position(|c| *c == 0)
                .unwrap_or(entry.szExeFile.len());
            let name = String::from_utf16_lossy(&entry.szExeFile[..len]);
            if let Some(exe) = EXECUTABLES.iter().find(|e| name.eq_ignore_ascii_case(e)) {
                found = Some(*exe);
                break;
            }
            has_entry = Process32NextW(snapshot, &mut entry) != 0;
        }

        CloseHandle(snapshot);
        found
    }
}

/// Prefers whichever build is already running so commands reach that instance.
fn executable(install: &Path) -> Option<PathBuf> {
    let running = running_executable().map(|exe| install.join(exe));
    running
        .into_iter()
        .chain(EXECUTABLES.iter().map(|exe| install.join(exe)))
        .find(|path| path.is_file())
}

/// An empty `configured` path means auto-detect through the Steam libraries.
pub fn find_install(configured: &str) -> Option<PathBuf> {
    let configured = configured.trim();
    if !configured.is_empty() {
        let install = PathBuf::from(configured);
        return executable(&install).map(|_| install);
    }

    steam_libraries()
        .into_iter()
        .map(|library| library.join(r"steamapps\common\wallpaper_engine"))
        .find(|install| executable(install).is_some())
}

/// Workshop subscriptions only; the install's built-in and local projects are left out.
fn project_roots(install: &Path) -> Vec<PathBuf> {
    let mut roots = Vec::new();

    let workshop = |steamapps: &Path| steamapps.join(r"workshop\content").join(WORKSHOP_APP_ID);
    if let Some(steamapps) = install.parent().and_then(Path::parent) {
        roots.push(workshop(steamapps));
    }
    roots.extend(
        steam_libraries()
            .iter()
            .map(|library| workshop(&library.join("steamapps"))),
    );

    let mut canonical: Vec<PathBuf> = roots
        .iter()
        .filter_map(|root| fs::canonicalize(root).ok())
        .collect();
    canonical.sort();
    canonical.dedup();
    canonical
}

fn read_project(dir: &Path) -> Option<Project> {
    let manifest_path = dir.join("project.json");
    let bytes = fs::read(&manifest_path).ok()?;
    let content = String::from_utf8_lossy(&bytes);
    let manifest: ProjectManifest =
        serde_json::from_str(content.trim_start_matches('\u{feff}')).ok()?;

    // Workshop manifests are third-party: the preview is exposed to the asset
    // protocol, so it has to be an image inside the project's own folder.
    let dir = fs::canonicalize(dir).ok()?;
    let preview = fs::canonicalize(dir.join(manifest.preview.as_deref()?)).ok()?;
    let extension = preview.extension()?.to_str()?.to_lowercase();
    if !preview.starts_with(&dir) || !PREVIEW_EXTENSIONS.contains(&extension.as_str()) {
        return None;
    }

    let fallback = dir.file_name()?.to_string_lossy().to_string();
    Some(Project {
        file: scanner::clean_path(&manifest_path)?,
        preview,
        title: manifest
            .title
            .filter(|title| !title.trim().is_empty())
            .unwrap_or(fallback),
        kind: manifest.kind.map(|kind| kind.to_lowercase()),
    })
}

pub fn scan(install: &Path, cache_dir: &Path) -> Result<Vec<WallpaperEntry>, String> {
    let mut projects: HashMap<String, Project> = HashMap::new();
    for root in project_roots(install) {
        let Ok(read_dir) = fs::read_dir(&root) else {
            app_warn!("[WallpaperEngine] Failed to read project root {:?}", root);
            continue;
        };
        for project in read_dir.flatten().filter_map(|e| read_project(&e.path())) {
            if let Some(key) = scanner::clean_path(&project.preview) {
                projects.insert(key, project);
            }
        }
    }

    let previews: Vec<PathBuf> = projects.values().map(|p| p.preview.clone()).collect();
    let mut entries = scanner::scan_files(&previews, cache_dir)?;
    for entry in &mut entries {
        if let Some(project) = projects.get(&entry.path) {
            entry.filename = project.title.clone();
            entry.project = Some(project.file.clone());
            entry.project_type = project.kind.clone();
        }
    }
    Ok(entries)
}

/// Commands take close to a second to return, so nothing here waits on them.
fn send_control(exe: &Path, args: &[&str]) -> std::io::Result<()> {
    let mut child = Command::new(exe)
        .arg("-control")
        .args(args)
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()?;
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}

fn start_and_wait(exe: &Path, install: &Path) -> std::io::Result<()> {
    Command::new(exe).current_dir(install).spawn()?;
    for _ in 0..STARTUP_POLLS {
        std::thread::sleep(STARTUP_POLL_INTERVAL);
        if running_executable().is_some() {
            std::thread::sleep(STARTUP_SETTLE);
            break;
        }
    }
    Ok(())
}

pub fn apply(install: &Path, project: &str) -> Result<(), String> {
    let abs_path = fs::canonicalize(project)
        .map_err(|e| format!("Failed to resolve path '{}': {}", project, e))?;
    let is_manifest = abs_path.file_name().is_some_and(|name| name == "project.json");
    if !is_manifest || !project_roots(install).iter().any(|r| abs_path.starts_with(r)) {
        return Err(format!(
            "Not a Wallpaper Engine project: {}",
            abs_path.display()
        ));
    }

    let exe = executable(install).ok_or("Wallpaper Engine executable not found")?;
    let file = scanner::clean_path(&abs_path)
        .ok_or_else(|| format!("Failed to resolve path '{}'", project))?;
    let args = ["openWallpaper", "-file", file.as_str()];

    if running_executable().is_some() {
        return send_control(&exe, &args)
            .map_err(|e| format!("Failed to run Wallpaper Engine: {}", e));
    }

    let install = install.to_path_buf();
    std::thread::spawn(move || {
        let args = ["openWallpaper", "-file", file.as_str()];
        let result = start_and_wait(&exe, &install).and_then(|_| send_control(&exe, &args));
        if let Err(e) = result {
            app_error!("[WallpaperEngine] Failed to start and apply: {}", e);
        }
    });
    Ok(())
}

/// A running wallpaper covers the Windows one, so static picks must clear it.
pub fn close_wallpapers(install: &Path) {
    if running_executable().is_none() {
        return;
    }
    let Some(exe) = executable(install) else {
        return;
    };
    if let Err(e) = send_control(&exe, &["closeWallpaper"]) {
        app_warn!("[WallpaperEngine] Failed to close wallpapers: {}", e);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_project(name: &str) -> PathBuf {
        let dir = std::env::temp_dir()
            .join(format!(
                "carousel_we_test_{}_{}",
                name,
                std::time::SystemTime::now()
                    .duration_since(std::time::SystemTime::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ))
            .join("project");
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn test_parse_library_paths() {
        let vdf = "\"libraryfolders\"\n{\n\t\"0\"\n\t{\n\t\t\"path\"\t\t\"C:\\\\Program Files (x86)\\\\Steam\"\n\t\t\"label\"\t\t\"\"\n\t}\n\t\"1\"\n\t{\n\t\t\"path\"\t\t\"D:\\\\SteamLibrary\"\n\t}\n}\n";
        assert_eq!(
            parse_library_paths(vdf),
            vec![
                PathBuf::from(r"C:\Program Files (x86)\Steam"),
                PathBuf::from(r"D:\SteamLibrary"),
            ]
        );
    }

    #[test]
    fn test_read_project_handles_bom_and_lowercases_type() {
        let dir = temp_project("bom");
        fs::write(dir.join("preview.gif"), b"gif").unwrap();
        fs::write(
            dir.join("project.json"),
            "\u{feff}{\"title\":\"Moonlight\",\"type\":\"Scene\",\"preview\":\"preview.gif\"}",
        )
        .unwrap();

        let project = read_project(&dir).expect("project should parse");
        assert_eq!(project.title, "Moonlight");
        assert_eq!(project.kind.as_deref(), Some("scene"));
        assert!(project.file.ends_with("project.json"));
        assert!(!project.file.starts_with(r"\\?\"));

        let _ = fs::remove_dir_all(dir.parent().unwrap());
    }

    #[test]
    fn test_read_project_falls_back_to_folder_name_for_title() {
        let dir = temp_project("title");
        fs::write(dir.join("preview.jpg"), b"jpg").unwrap();
        fs::write(dir.join("project.json"), r#"{"preview":"preview.jpg"}"#).unwrap();

        assert_eq!(read_project(&dir).unwrap().title, "project");

        let _ = fs::remove_dir_all(dir.parent().unwrap());
    }

    #[test]
    fn test_read_project_rejects_preview_outside_project() {
        let dir = temp_project("traversal");
        fs::write(dir.parent().unwrap().join("secret.png"), b"png").unwrap();
        fs::write(
            dir.join("project.json"),
            r#"{"title":"Evil","preview":"../secret.png"}"#,
        )
        .unwrap();

        assert!(read_project(&dir).is_none());

        let _ = fs::remove_dir_all(dir.parent().unwrap());
    }

    #[test]
    fn test_read_project_rejects_non_image_preview() {
        let dir = temp_project("extension");
        fs::write(dir.join("notes.txt"), b"text").unwrap();
        fs::write(
            dir.join("project.json"),
            r#"{"title":"Odd","preview":"notes.txt"}"#,
        )
        .unwrap();

        assert!(read_project(&dir).is_none());

        let _ = fs::remove_dir_all(dir.parent().unwrap());
    }

    #[test]
    fn test_read_project_skips_folder_without_manifest() {
        let dir = temp_project("missing");
        assert!(read_project(&dir).is_none());
        let _ = fs::remove_dir_all(dir.parent().unwrap());
    }
}
