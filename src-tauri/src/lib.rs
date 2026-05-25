mod error;
mod i18n;
mod consts;
use error::{Error};
use std::sync::{Arc, Mutex};
use tauri::AppHandle;
use tauri::Listener;
use tauri::Emitter;
use tokio::sync::oneshot;
use windows::{
    core::*,
    Foundation::*,
    Media::{
        Playback::{MediaPlayer},
        Core::{MediaSource},
        SpeechSynthesis::SpeechSynthesizer,
    },
};
use serde::{Serialize, Deserialize};
use std::result::Result as StdResult;
use std::fs;
use std::io;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::fs::OpenOptions;

fn touch_json<P: AsRef<Path>>(path: P) -> StdResult<(), Error> {
    let path = path.as_ref();

    if !path.exists() {
        match fs::write(path, "{}") {
            Ok(_) => {},
            Err(e) => return err_file_io!("failed to write json file"),
        }
    }

    Ok(())
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct Config {
    cwd: Option<String>,
}

impl Config {
    pub fn new() -> Self {
        Self {
            cwd: None,
        }
    }
}

fn save_config<P: AsRef<Path>>(path: P, config: &Config) -> StdResult<(), Error> {
    let json = match serde_json::to_string_pretty(config) {
        Ok(v) => v,
        Err(e) => return err_runtime!("failed to convert string config"),
    };

    match fs::write(path, json) {
        Ok(_) => {},
        Err(e) => return err_file_io!("failed to write config string"),
    };
    Ok(())
}

fn load_config<P: AsRef<Path>>(path: P) -> StdResult<Config, Error> {
    touch_json(&path)?;

    let text = match fs::read_to_string(path) {
        Ok(v) => v,
        Err(e) => return err_file_io!("failed to read config file"),
    };

    let config: Config = match serde_json::from_str(&text) {
        Ok(v) => v,
        Err(e) => return err_runtime!("failed to convert config string"),
    };

    Ok(config)
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct SpeakPayload {
    dummy: i32,
}

impl SpeakPayload {
    pub fn new() -> Self {
        Self {
            dummy: 0,
        }
    }
}

/**
    2026-02-04
    音声再生はWindows OneCoreを使う。これはWindowsが用意している機械音声。RustからWindows APIを叩き、textの音声を再生する。
    音声再生は非同期で行われるが、待機しないと再生がすぐ終了し、一聴すると音声が再生されていないように聞こえる。なので音声再生の完了を待機することと、割り込みで音声再生を停止する処理が必要。
    tokioのoneshot::channelで非同期で再生の完了を通知することで、再生の待機と割り込み時の再生終了を行うことができる。
 */
async fn do_speak(app: AppHandle, text: &str) -> Result<()> {
    let (tx, rx) = oneshot::channel::<()>();
    let tx = Arc::new(Mutex::new(Some(tx)));
    let tx1 = Arc::clone(&tx);
    let tx2 = Arc::clone(&tx);

    app.listen("stop_speak", move |_event| {
        println!("stop_speak");
        // stop_speakがemitされたらtokioのchannelに送信して処理を停止。
        if let Some(tx1) = tx1.lock().unwrap().take() {
            let _ = tx1.send(());
            println!("stop_speak done");;
        }
    });

    // 音声合成エンジン作成
    let synth = SpeechSynthesizer::new()?;

    // 音声データ生成
    let stream = synth
        .SynthesizeTextToStreamAsync(&HSTRING::from(text))?
        .await?;

    // ストリーム → MediaSource
    let source = MediaSource::CreateFromStream(&stream, &stream.ContentType()?)?;

    // プレイヤー作成
    let player = MediaPlayer::new()?;
    player.SetSource(&source)?;

    // -------- 再生終了待ち用チャネル --------

    let token = player.MediaEnded(&TypedEventHandler::new(
        move |_, _| {
            if let Some(tx2) = tx2.lock().unwrap().take() {
                let _ = tx2.send(());
            }
            Ok(())
        },
    ))?;

    // 再生
    player.Play()?;

    // 再生終了を待機
    let _ = rx.await;
    player.RemoveMediaEnded(token)?;

    let payload = SpeakPayload::new();
    app.emit("done_speak", payload).unwrap();
    Ok(())
}

#[tauri::command]
async fn speak(app: AppHandle, text: String) -> StdResult<(), Error> {
    println!("speak: {}", text);
    match do_speak(app, &text).await {
        Ok(_) => return Ok(()),
        Err(e) => return err_runtime!("failed to do speak: {}", e),
    }
}

fn get_exe_dir() -> StdResult<PathBuf, Error> {
    let exe_path = match std::env::current_exe() {
        Ok(v) => v,
        Err(e) => return err_runtime!("failed to get current exe path"),
    };

    let parent = match exe_path.parent() {
        Some(v) => v,
        None => return err_runtime!("failed to get parent of path"),
    };
    Ok(parent.to_path_buf())
}

fn get_config_path() -> StdResult<PathBuf, Error> {
    let mut exe_dir = get_exe_dir()?;
    Ok(exe_dir.join("config.json"))
}

fn get_cwd() -> StdResult<PathBuf, Error> {
    let config_path = get_config_path()?;
    let config = load_config(&config_path)?;
    let mut cwd: PathBuf;
    if let Some(scwd) = config.cwd {
        cwd = PathBuf::from(&scwd);
    } else {
        cwd = get_exe_dir()?;
    }
    Ok(cwd)
}

#[tauri::command]
async fn editor_cmd_write(
    content: String, 
    fname: String,
) -> StdResult<(), Error> {
    let cwd = get_cwd()?;
    let path = PathBuf::from(&fname);
    let target_path = if path.is_absolute() {
        path
    } else {
        cwd.join(path)
    };
    let mut file = match std::fs::File::create(&target_path) {
        Ok(v) => v,
        Err(e) => return err_file_io!("{}", i18n::failed_to_create_file(&target_path)),
    };

    let _ = write!(file, "{}", content);

    Ok(())
}

#[tauri::command]
async fn editor_cmd_read(fname: String) -> StdResult<String, Error> {
    let cwd = get_cwd()?;
    let mut content = String::new();
    let path = PathBuf::from(&fname);
    let target_path = if path.is_absolute() {
        path
    } else {
        cwd.join(path)
    };
    let text = match std::fs::read_to_string(&target_path) {
        Ok(v) => v,
        Err(e) => return err_file_io!("{}", i18n::failed_to_read_file(&target_path)),
    };

    content.push_str(&text);

    Ok(content)
}

#[tauri::command]
async fn cmd_pwd() -> StdResult<String, Error> {
    let cwd = get_cwd()?;
    Ok(cwd.to_string_lossy().to_string())
}

#[tauri::command]
async fn cmd_mkdir(
    args: Option<Vec<String>>,
) -> StdResult<(), Error> {
    let cwd = get_cwd()?;

    let args = match args {
        Some(v) => v,
        None => {
            return err_runtime!("missing directory name");
        }
    };

    if args.is_empty() {
        return err_runtime!("missing directory name");
    }

    let mut recursive = false;
    let mut targets: Vec<String> = Vec::new();

    // オプション解析
    for arg in args {
        if arg == "-p" {
            recursive = true;
        } else {
            targets.push(arg);
        }
    }

    if targets.is_empty() {
        return err_runtime!("missing directory name");
    }

    for target in targets {
        let path = PathBuf::from(&target);

        let target_path = if path.is_absolute() {
            path
        } else {
            cwd.join(path)
        };

        // 既にファイルならエラー
        if target_path.exists() && !target_path.is_dir() {
            return err_runtime!(
                "file exists: {}",
                target_path.to_string_lossy()
            );
        }

        let result = if recursive {
            fs::create_dir_all(&target_path)
        } else {
            fs::create_dir(&target_path)
        };

        match result {
            Ok(_) => {}

            Err(_) => {
                return err_file_io!(
                    "failed to create directory: {}",
                    target_path.to_string_lossy()
                );
            }
        }
    }

    Ok(())
}

#[tauri::command]
async fn cmd_touch(
    args: Option<Vec<String>>,
) -> StdResult<(), Error> {
    let cwd = get_cwd()?;

    let args = match args {
        Some(v) => v,
        None => {
            return err_runtime!("missing file path");
        }
    };

    if args.is_empty() {
        return err_runtime!("missing file path");
    }

    for arg in args {
        let path = PathBuf::from(&arg);

        let target_path = if path.is_absolute() {
            path
        } else {
            cwd.join(path)
        };

        // ディレクトリならエラー
        if target_path.exists() && target_path.is_dir() {
            return err_runtime!(
                "is a directory: {}",
                target_path.to_string_lossy()
            );
        }

        // 空ファイル作成
        match fs::OpenOptions::new()
            .create(true)
            .write(true)
            .open(&target_path)
        {
            Ok(_) => {}

            Err(_) => {
                return err_file_io!(
                    "failed to create file: {}",
                    target_path.to_string_lossy()
                );
            }
        }
    }

    Ok(())
}

#[tauri::command]
async fn cmd_rm(
    args: Option<Vec<String>>,
) -> StdResult<(), Error> {
    let cwd = get_cwd()?;

    let args = match args {
        Some(v) => v,
        None => {
            return err_runtime!("missing file path");
        }
    };

    if args.is_empty() {
        return err_runtime!("missing file path");
    }

    for arg in args {
        let path = PathBuf::from(&arg);

        let target_path = if path.is_absolute() {
            path
        } else {
            cwd.join(path)
        };

        // 存在確認
        if !target_path.exists() {
            return err_runtime!(
                "file not found: {}",
                target_path.to_string_lossy()
            );
        }

        // ゴミ箱へ移動
        match trash::delete(&target_path) {
            Ok(_) => {}

            Err(_) => {
                return err_file_io!(
                    "failed to move to trash: {}",
                    target_path.to_string_lossy()
                );
            }
        }
    }

    Ok(())
}

#[tauri::command]
async fn cmd_cat(
    args: Option<Vec<String>>,
) -> StdResult<String, Error> {
    let cwd = get_cwd()?;

    let args = match args {
        Some(v) => v,
        None => {
            return err_runtime!("{}", i18n::missing_file_path());
        }
    };

    if args.is_empty() {
        return err_runtime!("{}", i18n::missing_file_path());
    }

    let mut result = String::new();

    for arg in args {
        let path = PathBuf::from(&arg);

        let target_path = if path.is_absolute() {
            path
        } else {
            cwd.join(path)
        };

        // 正規化
        let target_path = match target_path.canonicalize() {
            Ok(v) => v,
            Err(_) => {
                return err_runtime!(
                    "{}",
                    i18n::file_nout_found(target_path.to_string_lossy().to_string())
                );
            }
        };

        // ファイル確認
        if !target_path.is_file() {
            return err_runtime!(
                "{}",
                i18n::not_a_file(target_path.to_string_lossy().to_string())
            );
        }

        // 読み込み
        let content = match fs::read_to_string(&target_path) {
            Ok(v) => v,
            Err(_) => {
                return err_file_io!(
                    "{}",
                    i18n::failed_to_read_file(target_path.to_string_lossy().to_string())
                );
            }
        };

        result.push_str(&content);

        // 複数ファイル時は改行区切り
        if !result.ends_with('\n') {
            result.push('\n');
        }
    }

    Ok(result)
}

#[tauri::command]
async fn cmd_ls(arg: Option<String>) -> StdResult<Vec<String>, Error> {
    let cwd = get_cwd()?;

    // 対象パス
    let target_path = match arg {
        Some(v) => {
            let path = PathBuf::from(v);

            if path.is_absolute() {
                path
            } else {
                cwd.join(path)
            }
        }

        None => cwd,
    };

    // 正規化
    let target_path = match target_path.canonicalize() {
        Ok(v) => v,
        Err(_) => {
            return err_runtime!(
                "directory not found: {}",
                target_path.to_string_lossy()
            );
        }
    };

    // ディレクトリ確認
    if !target_path.is_dir() {
        return err_runtime!(
            "not a directory: {}",
            target_path.to_string_lossy()
        );
    }

    // 読み込み
    let entries = match fs::read_dir(&target_path) {
        Ok(v) => v,
        Err(_) => {
            return err_file_io!(
                "failed to read directory: {}",
                target_path.to_string_lossy()
            );
        }
    };

    let mut result: Vec<String> = Vec::new();

    for entry in entries {
        let entry = match entry {
            Ok(v) => v,
            Err(_) => {
                continue;
            }
        };

        let path = entry.path();

        let mut name = match path.file_name() {
            Some(v) => v.to_string_lossy().to_string(),
            None => {
                continue;
            }
        };

        // ディレクトリなら末尾に /
        if path.is_dir() {
            name.push('/');
        }

        result.push(name);
    }

    result.sort();

    Ok(result)
}

#[tauri::command]
async fn cmd_cd(arg: Option<String>) -> StdResult<String, Error> {
    let config_path = get_config_path()?;
    let mut config = load_config(&config_path)?;

    // 現在のcwd
    let current_cwd = if let Some(scwd) = &config.cwd {
        PathBuf::from(scwd)
    } else {
        get_exe_dir()?
    };

    // 引数なしならホームディレクトリ
    let target_path = match arg {
        Some(v) => {
            let path = PathBuf::from(&v);

            if path.is_absolute() {
                path
            } else {
                current_cwd.join(path)
            }
        }

        None => {
            match dirs::home_dir() {
                Some(v) => v,
                None => {
                    return err_runtime!("failed to get home directory");
                }
            }
        }
    };

    // 正規化
    let mut next_cwd = match target_path.canonicalize() {
        Ok(v) => v,
        Err(_) => {
            return err_runtime!(
                "directory not found: {}",
                target_path.to_string_lossy()
            );
        }
    };

    // ディレクトリ確認
    if !next_cwd.is_dir() {
        return err_runtime!(
            "not a directory: {}",
            next_cwd.to_string_lossy()
        );
    }


    let mut scwd = next_cwd.to_string_lossy().to_string();
    scwd = scwd.replace("\\\\?\\", "");

    // 保存
    config.cwd = Some(scwd.clone());

    save_config(&config_path, &config)?;

    Ok(scwd)
}

#[tauri::command]
async fn cwd() -> StdResult<String, Error> {
    let cwd = get_cwd()?;
    Ok(cwd.to_string_lossy().to_string())
}

#[tauri::command]
async fn list_cwd() -> StdResult<Vec<String>, Error> {
    let cwd = get_cwd()?;
    let mut result = Vec::new();

    for entry in match fs::read_dir(cwd) {
        Ok(v) => v,
        Err(e) => return err_file_io!("failed to read dir"),
    } {
        let entry = match entry {
            Ok(v) => v,
            Err(e) => return err_runtime!("failed to unwrap entry"),
        };
        let path = entry.path();

        if let Some(name) = path.file_name() {
            result.push(name.to_string_lossy().to_string());
        }
    }

    Ok(result)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            speak,
            list_cwd,
            cwd,
            cmd_cd,
            cmd_ls,
            cmd_cat,
            cmd_rm,
            cmd_touch,
            cmd_mkdir,
            cmd_pwd,
            editor_cmd_write,
            editor_cmd_read,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
