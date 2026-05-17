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
		return this.get('ファイルを複数取得しました。読み上げる場合は、F2、をタイプしてください。', '')
	}

	speakStartListFiles () {
		return this.get('複数ファイルを読み上げます。中断する場合は、Control C、をタイプしてください。', '')
	}

	speakFileNumber (i) {
		return this.get(`${i}番`, `Number ${i}`)
	}
}
