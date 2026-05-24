const { invoke } = window.__TAURI__.core;
const { listen, emit } = window.__TAURI__.event;
import * as nue from './nue/nue.js'
import {MODE_FIRST} from './consts.js'
import i18n from './i18n.js'

function isAlnum (c) {
  return /[a-zA-Z0-9]/.test(c)
}

function isSymbol (c) {
  return !isAlnum(c)
}

class EditorBuffer {
  constructor () {
    this.lines = [''] /* Array<String> */
    this.cursorX = 0 /* Number */
    this.cursorY = 0 /* Number */
    this.mode = 'NORMAL' /* String */
    this.path = null /* String */
    this.lastTime = Date.now()
    this.lastKeys = [] /* Array<String> */
  }
}

class EditorNotebook extends nue.Notebook {
  constructor (model) {
    super({
      class: 'editor-notebook'
    })
    this.model = model
  }

  focus () {
    let tab = this.tabs.children[this.curIndex]
    if (tab) {
      tab.component.focus()
    }
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

  focus () {
    console.log('focused!')
    this.elem.focus()
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

    this.input = new EditorHiddenInput()

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

    let lastTime = Date.now()
    // console.log(lastTime, this.buffer.lastTime, lastTime - this.buffer.lastTime)
    if (lastTime - this.buffer.lastTime >= 300) {
      this.buffer.lastKeys = [ev.key]
    } else {
      this.buffer.lastKeys.push(ev.key)
    }
    this.buffer.lastTime = lastTime
    // console.log(this.buffer.lastKeys)

    console.log(ev.key)
    switch (ev.key) {
    case '%':
      if (ev.shiftKey) {
        this.moveCursorTail()
        this.buffer.lastKeys = []
      }
      break
    case 'Backspace':
      this.moveCursorBack()
      this.buffer.lastKeys = []
      break
    case 'Enter':
      this.moveCursorDown()
      this.buffer.lastKeys = []
      break
    case 'w':
      switch (this.buffer.lastKeys.join('')) {
      case 'w':
        this.moveCursorWord()
        this.buffer.lastKeys = []
        break
      case 'dw':
        this.deleteWord()
        this.buffer.lastKeys = []
        break
      }
      break
    case 'b':
      switch (this.buffer.lastKeys.join('')) {
      case 'b':
        this.moveCursorWordBack()
        this.buffer.lastKeys = []
        break
      case 'db':
        this.deleteWordBack()
        this.buffer.lastKeys = []
        break
      }
      break
    case 'd':
      switch (this.buffer.lastKeys.join('')) {
      case 'dd':
        this.deleteLine()
        this.buffer.lastKeys = []
        break
      case 'd':
        if (ev.ctrlKey) {
          this.moveCursor(0, 10)
          this.buffer.lastKeys = []
        }
        break
      }
      break
    case 'ArrowLeft':
    case 'h':
      this.moveCursor(-1, 0)
      this.buffer.lastKeys = []
      break
    case 'ArrowDown':
    case 'j':
      this.moveCursor(0, 1)
      this.buffer.lastKeys = []
      break
    case 'ArrowUp':
    case 'k':
      this.moveCursor(0, -1)
      this.buffer.lastKeys = []
      break
    case 'ArrowRight':
    case 'l':
      this.moveCursor(1, 0)
      this.buffer.lastKeys = []
      break
    case 'i':
      this.buffer.mode = 'INSERT'
      this.input.setValue('')
      this.buffer.lastKeys = []
      break
    case 'a':
      this.buffer.mode = 'INSERT'
      this.moveCursor(1, 0)
      this.input.setValue('')
      this.buffer.lastKeys = []
      break
    case 'A':
      this.buffer.mode = 'INSERT'
      this.moveCursorTail()
      this.input.setValue('')
      this.buffer.lastKeys = []
      break
    case 'O':
      this.buffer.mode = 'INSERT'
      this.insertNewlineUp()
      this.buffer.lastKeys = []
      break
    case 'o':
      this.buffer.mode = 'INSERT'
      this.insertNewlineDown()
      this.buffer.lastKeys = []
      break
    case 'x':
      this.deleteChar()
      this.moveCursor(-1, 0)
      this.buffer.lastKeys = []
      break
    case 'u':
      if (ev.ctrlKey) {
        this.moveCursor(0, -10)
        this.buffer.lastKeys = []
      }
      break
    }
  }

  countWordBack () {
    let y = this.buffer.cursorY
    let x = this.buffer.cursorX-1
    let line = this.buffer.lines[y]
    if (!line) {
      return 0
    }
    let m = 0
    let n = 0

    // console.log(`line[${line}] x[${x}] len[${line.length}]`)
    for (; x >= 0 && x <= line.length; x--) {
      let c = line[x]
      // console.log(`${m} [${c}]`)
      if (m === 0) {
        if (isAlnum(c)) {
          m = 10
          n--
        } else {
          m = 20
          n--
        }
      } else if (m === 10) { // alnum
        if (isAlnum(c)) {
          n--
        } else {
          break
        }
      } else if (m === 20) { // !alnum
        if (!isAlnum(c)) {
          n--
        } else {
          break
        }
      }
    }

    return n
  }

  countWord () {
    let y = this.buffer.cursorY
    let x = this.buffer.cursorX
    let line = this.buffer.lines[y]
    if (!line) {
      return 0
    }
    let m = 0
    let n = 0

    for (; x >= 0 && x <= line.length; x++) {
      let c = line[x]
      if (m === 0) {
        if (isAlnum(c)) {
          m = 10
          n++
        } else {
          m = 20
          n++
        }
      } else if (m === 10) { // alnum
        if (isAlnum(c)) {
          n++
        } else {
          break
        }
      } else if (m === 20) { // !alnum
        if (!isAlnum(c)) {
          n++
        } else {
          break
        }
      }
    }

    return n
  }

  setNormal () {
    this.buffer.mode = 'NORMAL'
    this.input.setValue('')
  }

  async onInsertKeydown (ev) {
    switch (ev.key) {
    case 'ArrowLeft':
      this.moveCursor(-1, 0)
      this.buffer.lastKeys = []
      break
    case 'ArrowDown':
      this.moveCursor(0, 1)
      this.buffer.lastKeys = []
      break
    case 'ArrowUp':
      this.moveCursor(0, -1)
      this.buffer.lastKeys = []
      break
    case 'ArrowRight':
      this.moveCursor(1, 0)
      this.buffer.lastKeys = []
      break
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
    this.buffer.cursorX = line ? line.length : 0
  }

  moveCursorWord () {
    let n = this.countWord()
    this.moveCursor(n, 0)
  }

  moveCursorWordBack () {
    let n = this.countWordBack()
    this.moveCursor(n, 0)
  }

  moveCursorDown () {
    let x = this.buffer.cursorX
    let y = this.buffer.cursorY
    if (y < this.buffer.lines.length) {
      this.moveCursor(0, 1)
      if (y+1 < this.buffer.lines.length) {
        let line = this.buffer.lines[y+1]
        this.buffer.cursorX = Math.min(x, line.length)
      }
    }
  }

  moveCursorBack () {
    let x = this.buffer.cursorX
    let y = this.buffer.cursorY
    if (x === 0 && y > 0) {
      let line = this.buffer.lines[y-1]
      if (line != null) {
        this.moveCursor(line.length, -1)
      }
    } else {
      this.moveCursor(-1, 0)
    }
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
          line ? line.length : 0,
        )
      )
  }

  insertChar (ch) {
    let y = this.buffer.cursorY
    let x = this.buffer.cursorX
    if (!this.buffer.lines.length) {
      this.buffer.lines.push('')
    }
    let line = this.buffer.lines[y]

    this.buffer.lines[y] = line.slice(0, x) + ch + line.slice(x)
    this.buffer.cursorX++
  }

  deleteLine () {
    let y = this.buffer.cursorY
    this.buffer.lines.splice(y, 1)
  }

  deleteWordBack () {
    let n = this.countWordBack()
    let x = this.buffer.cursorX
    let y = this.buffer.cursorY
    let line = this.buffer.lines[y]
    if (!line) {
      return
    }  

    this.buffer.lines[y] = line.slice(0, x + n) + line.slice(x)
    this.moveCursor(n, 0)
  }
  
  deleteWord () {
    let n = this.countWord()
    let x = this.buffer.cursorX
    let y = this.buffer.cursorY
    let line = this.buffer.lines[y]
    if (!line) {
      return
    }  

    this.buffer.lines[y] = line.slice(0, x) + line.slice(x + n)
  }
  
  deleteChar () {
    let y = this.buffer.cursorY
    let x = this.buffer.cursorX
    let line = this.buffer.lines[y]
    if (!line) {
      return
    }
    if (x >= line.length) {
      return
    }

    this.buffer.lines[y] = line.slice(0, x) + line.slice(x + 1)
  }

  backspace () {
    let y = this.buffer.cursorY
    let x = this.buffer.cursorX
    let line = this.buffer.lines[y]

    if (x <= 0 && y > 0) {
      this.buffer.lines.splice(y, 1)
      if (y-1 >= 0) {
        let line = this.buffer.lines[y-1]
        x = line.length
      }
      this.buffer.cursorX = x
      this.buffer.cursorY--
    } else {
      this.buffer.lines[y] = line.slice(0, x - 1) + line.slice(x)

      if (this.buffer.cursorX) {
        this.buffer.cursorX--
      }
    }
  }

  insertNewlineUp () {
    let y = this.buffer.cursorY
    this.buffer.lines.splice(y, 0, '')    
    // this.buffer.cursorY
  }

  insertNewlineDown () {
    let y = this.buffer.cursorY
    this.buffer.lines.splice(y+1, 0, '')    
    this.buffer.cursorY++
  }

  insertNewline () {
    let y = this.buffer.cursorY
    let x = this.buffer.cursorX
    let line = this.buffer.lines[y]
    let left = line ? line.slice(0, x) : ''
    let right = line ? line.slice(x) : ''

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

  focus () {
    this.notebook.focus()
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
