use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

static LOG_PATH: Mutex<Option<PathBuf>> = Mutex::new(None);
static START_TIME: OnceLock<Instant> = OnceLock::new();

pub fn init(path: PathBuf) {
    START_TIME.get_or_init(Instant::now);
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(mut f) = OpenOptions::new().create(true).write(true).truncate(true).open(&path) {
        let _ = writeln!(f, "=== Carousel Wallpaper Changer Log Started ===");
        let _ = writeln!(f, "Log file: {}", path.display());
    }
    eprintln!("[Carousel Log] Log file initialized at: {}", path.display());
    *LOG_PATH.lock().unwrap() = Some(path);
}

pub fn log(level: &str, msg: &str) {
    let start = START_TIME.get_or_init(Instant::now);
    let elapsed = start.elapsed().as_secs_f64();
    let line = format!("[+{:08.3}s] [{}] {}", elapsed, level, msg);

    eprintln!("{}", line);

    if let Ok(guard) = LOG_PATH.lock() {
        if let Some(ref path) = *guard {
            if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(path) {
                let _ = writeln!(f, "{}", line);
            }
        }
    }
}

macro_rules! app_info {
    ($($arg:tt)*) => {
        $crate::logger::log("INFO", &format!($($arg)*))
    };
}

macro_rules! app_warn {
    ($($arg:tt)*) => {
        $crate::logger::log("WARN", &format!($($arg)*))
    };
}

macro_rules! app_error {
    ($($arg:tt)*) => {
        $crate::logger::log("ERROR", &format!($($arg)*))
    };
}

pub(crate) use app_error;
pub(crate) use app_info;
pub(crate) use app_warn;
