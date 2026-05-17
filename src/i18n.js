import {COMMAND_NAMES} from './consts.js'

export default new class I18N {
	constructor () {
		this.lang = 'ja'
	}

	get (ja, en) {
		if (this.lang === 'ja') {
			return ja
		} else {
			return en
		}
	}

	speakHasListFiles () {
		return this.get('ファイルを複数取得しました。読み上げる場合は、Control Q、をタイプしてください。', '')
	}

	speakStartListFiles () {
		return this.get('複数ファイルを読み上げます。中断する場合は、Control C、をタイプしてください。', '')
	}

	speakFileNumber (i) {
		return this.get(`${i}番`, `Number ${i}`)
	}

	doneCd (cwd) {
		return this.get(`現在のフォルダは、${cwd}`, '')
	}

	doneCat () {
		return this.get('ファイル内容を取得しました。音読する場合は、Control Q、をタイプしてください。')
	}

	focusedWindow () {
		return this.get('ウィンドウにフォーカスしました。コマンド入力欄にフォーカスするには、Control I、をタイプしてください。ヘルプを参照するには、Control H、をタイプしてください。', '')
	}

	bluredWindow () {
		return this.get('ウィンドウからフォーカスがはずれました。', '')
	}

	focusedCmdLineInput () {
		return this.get('コマンド入力欄にフォーカスしました。', '')
	}

	failedCommandExec (error) {
		return this.get(`コマンドの実行に失敗しました。${error}`, '')
	}

	isEmptyShellInput () {
		return this.get('入力欄はカラです。', '')
	}

	cancelled () {
		return this.get('キャンセルしました。', '')
	}

	helpDesc () {
		return this.get('ヘルプにようこそ。このソフトウェアのアバウトは、1、を。コマンドのヘルプは、2、をタイプしてください。')
	}

	appAbout () {
		return this.get('このソフトウェアは2026年2月に開発が開始されました。視覚障害がある人でもソフトウェア開発が出来るようにすることを目標に開発がされています。', '')
	}

	commandHelp () {
		let cmds = COMMAND_NAMES.join('、').split('').join(' ')
		return this.get(`使用できるコマンドは、${cmds}です。各コマンドの解説は、コマンド入力欄に、ヘルプ、コマンドめい、と英字でタイプしてください。`)
	}
}
