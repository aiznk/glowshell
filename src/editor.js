const { invoke } = window.__TAURI__.core;
const { listen, emit } = window.__TAURI__.event;
import * as nue from './nue/nue.js'
import {
  DEBUG,
  MODE_FIRST,
  MODE_HAS_LIST_FILES,
  MODE_DONE_CD,
  MODE_DONE_CAT,
  MODE_HELP,
  MODE_EDITOR,
} from './consts.js'
import i18n from './i18n.js'

class EditorBuffer {
  constructor () {
    this.lines = ['']
    this.cursorX = 0
    this.cursorY = 0
    this.mode = 'NORMAL'
    this.path = null
  }
}

class EditorNotebook extends nue.Notebook {
  constructor (model) {
    super({ class: 'editor-notebook' })
    this.model = model
  }
}

class EditorHiddenInput extends nue.Textarea {
  constructor () {
    super({
      class: 'editor-hidden-input',
    }, {
      events: [
        'keydown',
        'input',
        'blur',
      ],
    })
  }

  async onKeydown (ev) {
    await this.emit('editorKeydown', ev)
  }

  async onInput (ev) {
    await this.emit(
      'editorInput',
      this.getValue()
    )
  }

  async onBlur () {
    this.focus()
  }
}

class EditorPage extends nue.Div {
  constructor (model, fname) {
    super({
      class: 'editor-page',
    })

    this.model = model
    this.fname = fname
    this.buffer = new EditorBuffer()

    this.renderLayer = new nue.Pre({
      class: 'editor-render',
    })

    this.statusBar = new nue.Div({
      class: 'editor-status',
    })

    this.input =
      new EditorHiddenInput()

    this.add(this.renderLayer)
    this.add(this.statusBar)
    this.add(this.input)

    this.render()
  }

  focus () {
    this.input.focus()
  }

  async receive (key, val) {
    switch (key) {
    case 'editorKeydown':
      await this.onEditorKeydown(val)
      break
    case 'editorInput':
      await this.onEditorInput(val)
      break
    }
  }

  async onEditorKeydown (ev) {
    switch (this.buffer.mode) {
    case 'NORMAL':
      await this.onNormalKeydown(ev)
      break
    case 'INSERT':
      await this.onInsertKeydown(ev)
      break
    }

    this.render()
  }

  async onNormalKeydown (ev) {
    ev.preventDefault()

    switch (ev.key) {
    case 'h':
      this.moveCursor(-1, 0)
      break
    case 'j':
      this.moveCursor(0, 1)
      break
    case 'k':
      this.moveCursor(0, -1)
      break
    case 'l':
      this.moveCursor(1, 0)
      break
    case 'i':
      this.buffer.mode = 'INSERT'
      this.input.setValue('')
      break
    case 'a':
      this.buffer.mode = 'INSERT'
      this.moveCursor(1, 0)
      this.input.setValue('')
      break
    case 'A':
      this.buffer.mode = 'INSERT'
      this.moveCursorTail()
      this.input.setValue('')
      break
    case 'o':
      this.buffer.mode = 'INSERT'
      this.moveCursorTail()
      this.insertNewline()
      this.input.setValue('')
    case 'x':
      this.deleteChar()
      break
    case 'd':
      if (ev.ctrlKey) {
        this.moveCursor(0, 10)
      }
      break
    case 'u':
      if (ev.ctrlKey) {
        this.moveCursor(0, -10)
      }
      break
    }
  }

  setNormal () {
    this.buffer.mode = 'NORMAL'
    this.input.setValue('')
  }

  async onInsertKeydown (ev) {
    switch (ev.key) {
    case 'Escape':
      ev.preventDefault()
      this.setNormal()
      break
    case 'Backspace':
      ev.preventDefault()
      this.backspace()
      this.input.setValue('')
      break
    case 'Enter':
      ev.preventDefault()
      this.insertNewline()
      this.input.setValue('')
      break
    case '[':
      if (ev.ctrlKey) {
        ev.preventDefault()
        this.setNormal()
        this.moveCursor(-1, 0)
      }
      break
    }
  }

  async onEditorInput (text) {
    if (this.buffer.mode !== 'INSERT') {
      return
    }
    if (!text.length) {
      return
    }

    for (let ch of text) {
      this.insertChar(ch)
    }

    this.input.setValue('')
    this.render()
  }

  render () {
    let out = []

    for (let y = 0; y < this.buffer.lines.length; y++) {
      let line = this.buffer.lines[y]

      if (y === this.buffer.cursorY) {
        let x = this.buffer.cursorX
        let left = line.slice(0, x)
        let cur = line[x] || ' '
        let right = line.slice(x + 1)

        line = left + `<span class="editor-cursor">${cur}</span>` + right
      }

      out.push(line)
    }

    this.renderLayer.setHTML(
      out.join('\n')
    )

    this.statusBar.setText(
      `${this.buffer.mode} ${this.fname} ${this.buffer.cursorY+1}:${this.buffer.cursorX+1}`
    )
  }

  moveCursorTail () {
    let line = this.buffer.lines[this.buffer.cursorY]
    this.buffer.cursorX = line.length
  }

  moveCursor (dx, dy) {
    this.buffer.cursorY += dy

    this.buffer.cursorY = 
      Math.max(
        0,
        Math.min(
          this.buffer.cursorY,
          this.buffer.lines.length - 1
        )
      )

    let line = this.buffer.lines[this.buffer.cursorY]

    this.buffer.cursorX += dx
    this.buffer.cursorX =
      Math.max(
        0,
        Math.min(
          this.buffer.cursorX,
          line.length
        )
      )
  }

  insertChar (ch) {
    let y = this.buffer.cursorY
    let x = this.buffer.cursorX
    let line = this.buffer.lines[y]

    this.buffer.lines[y] = line.slice(0, x) + ch + line.slice(x)
    this.buffer.cursorX++
  }

  deleteChar () {
    let y = this.buffer.cursorY
    let x = this.buffer.cursorX
    let line = this.buffer.lines[y]

    if (x >= line.length) {
      return
    }

    this.buffer.lines[y] = line.slice(0, x) + line.slice(x + 1)
  }

  backspace () {
    let y = this.buffer.cursorY
    let x = this.buffer.cursorX

    if (x <= 0) {
      return
    }

    let line = this.buffer.lines[y]

    this.buffer.lines[y] = line.slice(0, x - 1) + line.slice(x)
    this.buffer.cursorX--
  }

  insertNewline () {
    let y = this.buffer.cursorY
    let x = this.buffer.cursorX
    let line = this.buffer.lines[y]
    let left = line.slice(0, x)
    let right = line.slice(x)

    this.buffer.lines[y] = left
    this.buffer.lines.splice(y + 1, 0, right)
    this.buffer.cursorY++
    this.buffer.cursorX = 0
  }
}

export class Editor extends nue.Div {
  constructor (model) {
    super({ class: 'editor' })

    this.model = model
    this.notebook = new EditorNotebook(this.model)
    this.add(this.notebook)
  }

  setup (args) {
    this.notebook.clear()

    if (!args.length) {
      args = ['empty']
    }

    for (let arg of args) {
      let page = new EditorPage(this.model, arg)
      let tab = new nue.NotebookTab(arg, page)
      this.notebook.addTab(tab)
    }

    this.notebook.click(0)

    setTimeout(() => {
      let tab = this.notebook.tabs.children[0]
      tab.component.focus()
    }, 100)
  }

  async receive (key, val) {
    switch (key) {
    case 'quitEditor':
      this.hide()
      this.model.refShellMode.value = MODE_FIRST
      break
    }
  }
}
