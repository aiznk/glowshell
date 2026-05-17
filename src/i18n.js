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
		return this.get('ウィンドウにフォーカスしました。コマンド入力欄にフォーカスするには、Control I、をタイプしてください。', '')
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
}
