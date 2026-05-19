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

	speakHasListFiles (files) {
		if (files.length) {
			return this.get('ファイルを複数取得しました。読み上げる場合は、Control Q、をタイプしてください。', '')
		} else {
			return this.get('ファイルリストはカラでした。', '')
		}
	}

	speakStartListFiles () {
		return this.get('複数ファイルを読み上げます。中断する場合は、Control C、をタイプしてください。', '')
	}

	speakFileNumber (i) {
		return this.get(`${i}番`, `Number ${i}`)
	}

	doneCd () {
		return this.get(`移動しました。`, '')
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

	helpLs () {
		return this.get('エルエスコマンドは、現在のフォルダ内のファイルを一覧します。', '')
	}

	helpCd () {
		return this.get('シーディーコマンドは、引数のパスに現在のフォルダを移動します。', '')
	}

	helpCat () {
		return this.get('カットコマンドは、引数のファイルの内容を表示します。', '')
	}

	helpLcat () {
		return this.get('エルカットコマンドは、エルエスコマンドで取得したファイルを番号で参照します。', '')
	}

	helpRm () {
		return this.get('アールエムコマンドは、引数のファイルをゴミ箱に移動します。', '')
	}

	helpTouch () {
		return this.get('タッチコマンドは、カラファイルを作成します。', '')
	}

	helpMkdir () {
		return this.get('エムケーディレコマンドは、フォルダを作成します。', '')
	}

	unknownCmdName () {
		return this.get('不明なコマンドめいです。', '')
	}

	invalidArgs () {
		return this.get('不正な引数です。', '')
	}

	doneMkdir () {
		return this.get('フォルダを作成しました。')
	}

	doneTouch () {
		return this.get('カラファイルを作成しました。')
	}

	doneRm () {
		return this.get('ファイルをゴミ箱に移動しました。')
	}

	textIsEmpty () {
		return this.get('テキストはカラです。')
	}

	filesIsEmpty () {
		return this.get('ファイルリストはカラです。')
	}

	success () {
		return this.get('成功。')
	}
}
