use crate::consts::{LANG};

fn get(ja: &str, en: &str) -> String {
	if LANG == "ja" {
		return ja.to_string();
	} else {
		return en.to_string();
	}
}

pub fn missing_file_path() -> String {
	return get("ファイルパスがありません。", "");
}

pub fn file_nout_found(path: String) -> String {
	return get(&format!("ファイルが見つかりません。{}", path), "");
}

pub fn not_a_file(path: String) -> String {
	return get(&format!("ファイルではありません。{}", path), "");
}

pub fn failed_to_read_file(path: String) -> String {
	return get(&format!("ファイルの読み込みに失敗しました。{}", path), "");
}
