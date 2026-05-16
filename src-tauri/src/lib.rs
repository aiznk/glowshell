mod error;
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
        // stop_speakがemitされたらtokioのchannelに送信して処理を停止。
        if let Some(tx1) = tx1.lock().unwrap().take() {
            let _ = tx1.send(());
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
