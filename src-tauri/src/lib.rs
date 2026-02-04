use std::result::Result as StdResult;
use tokio::sync::oneshot;
use std::time::Duration;
use windows::{
    core::*,
    Foundation::*,
    Media::{
        Playback::{MediaPlayer},
        Core::{MediaSource},
        SpeechSynthesis::SpeechSynthesizer,
    },
};

/**
    2026-02-04
    音声再生はWindows OneCoreを使う。これはWindowsが用意している機械音声。RustからWindows APIを叩き、textの音声を再生する。
    音声再生は非同期で行われるが、待機しないと再生がすぐ終了し、一聴すると音声が再生されていないように聞こえる。なので音声再生の完了を待機することと、割り込みで音声再生を停止する処理が必要。
    tokioのoneshot::channelで非同期で再生の完了を通知することで、再生の待機と割り込み時の再生終了を行うことができる。
 */
async fn do_speak(text: &str) -> Result<()> {
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

    let (tx, rx) = oneshot::channel::<()>();
    let mut tx = Some(tx);

    let token = player.MediaEnded(&TypedEventHandler::new(
        move |_, _| {
            if let Some(tx) = tx.take() {
                let _ = tx.send(());
            }
            Ok(())
        },
    ))?;

    // 再生
    player.Play()?;

    // 再生終了を待機
    let _ = rx.await;
    player.RemoveMediaEnded(token)?;

    Ok(())
}

#[tauri::command]
async fn speak(text: String) -> StdResult<(), String> {
    println!("speak: {}", text);
    match do_speak(&text).await {
        Ok(_) => return Ok(()),
        Err(e) => return Err(format!("failed to do speak: {:?}", e)),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![speak])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
