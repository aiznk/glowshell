const { invoke } = window.__TAURI__.core;
const { listen, emit } = window.__TAURI__.event;
import * as nue from './nue.js'
import {fixSpeakText, writeToClipboard, readFromClipboard} from './utils.js'
import {MODE_FIRST} from './consts.js'
import i18n from './i18n.js'

function isAlnum (c) {
  return /[a-zA-Z0-9]/.test(c)
}

function isSymbol (c) {
  return !isAlnum(c)
}

function isCommandChar (c) {
  return /[a-zA-Z0-9\_\-\ \.]/.test(c)
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
    this.command = '' /* String */
    this.isEdited = false /* Boolean */
    this.visualLineStartCursorY = 0

    // Undo/Redo
    this.undoStack = []
    this.redoStack = []

    // INSERTモード編集中か
    this.insertSession = false
  }
}

export class EditorCommandResult {
  constructor () {
    this.cmdName = null
    this.text = null
    this.fname = null
  }
}

export class EditorCommand {
  constructor (
    buffer /* EditorBuffer */,
    fname /* String */,
  ) {
    this.buffer = buffer
    this.fname = fname
    this.name = null
    this.args = []
  }

  parse (scmd) {
    let toks = scmd.trim().split(' ')
    if (!toks.length) {
      return
    }

    this.name = toks[0]

    if (toks.length >= 2) {
      toks.shift()
      this.args = toks
    }
  }

  async exec () {
    let ret = new EditorCommandResult()

    switch (this.name) {
    case '!q':
    case '!quit':
      ret.cmdName = 'quit'
      break
    case 'q':
    case 'quit':
      ret.cmdName = 'quit'
      if (this.buffer.isEdited) {
        throw new Error(i18n.fileIsEditing())
      }
      break
    case 'w':
    case 'write':
      ret.cmdName = 'write'

      if (this.args.length && this.fname == null) {
        this.fname = this.args[0]
      }
      if (this.fname == null) {
        throw new Error(i18n.invalidArgs())
      }
      try {
        await invoke('editor_cmd_write', {
          content: this.buffer.lines.join('\n'),
          fname: this.fname,
        })
      } catch (e) {
        throw e
      }

      ret.fname = this.fname
      this.buffer.isEdited = false

      break
    case 'r':
    case 'read': {
      ret.cmdName = 'read'

      if (this.args.length && this.fname == null) {
        this.fname = this.args[0]
      }
      if (this.fname == null) {
        throw new Error(i18n.invalidArgs())
      }
      try {
        ret.text = await invoke('editor_cmd_read', {
          fname: this.fname,
        })
      } catch (e) {
        throw e
      }

      ret.fname = this.fname
      this.buffer.isEdited = false
      
    } break
    }

    return ret
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
    try {
      await this.emit('editorKeydown', ev)
    } catch (e) {
      throw e
    }
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

  async load () {
    let text

    if (this.fname == null) {
      return
    }

    try {
      text = await invoke('editor_cmd_read', {
        fname: this.fname,
      })
    } catch (e) {
      throw e
    }

    this.buffer.lines = text.replace('\r\n', '\n').split('\n')
    this.render()
  }

  createSnapshot () {
    return {
      lines: [...this.buffer.lines],
      cursorX: this.buffer.cursorX,
      cursorY: this.buffer.cursorY,
    }
  }

  restoreSnapshot (snap) {
    this.buffer.lines = [...snap.lines]
    this.buffer.cursorX = snap.cursorX
    this.buffer.cursorY = snap.cursorY
  }

  pushUndo () {
    this.buffer.undoStack.push(
      this.createSnapshot()
    )

    // Undo後に編集したらRedo破棄
    this.buffer.redoStack = []

    // メモリ暴走防止
    if (this.buffer.undoStack.length > 1000) {
      this.buffer.undoStack.shift()
    }
  }

  undo () {
    let snap = this.buffer.undoStack.pop()
    if (!snap) {
      return
    }

    this.buffer.redoStack.push(
      this.createSnapshot()
    )

    this.restoreSnapshot(snap)
  }

  redo () {
    let snap = this.buffer.redoStack.pop()
    if (!snap) {
      return
    }

    this.buffer.undoStack.push(
      this.createSnapshot()
    )

    this.restoreSnapshot(snap)
  }

  startInsertSession () {
    if (!this.buffer.insertSession) {
      this.pushUndo()
      this.buffer.insertSession = true
    }
  }

  endInsertSession () {
    this.buffer.insertSession = false
  }

  focus () {
    this.input.focus()
  }

  async receive (key, val) {
    this.error = null
    
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
    case 'COMMAND':
      await this.onCommandKeydown(ev)
      break
    case 'VISUAL LINE':
      await this.onVisualLineKeydown(ev)
      break
    }

    this.render()
  }

  async yankVisualLine () {
    let sy = Math.min(this.buffer.visualLineStartCursorY, this.buffer.cursorY)
    let ey = Math.max(this.buffer.visualLineStartCursorY, this.buffer.cursorY)
    let lines = []

    for (let y = sy; y < ey+1; y++) {
      lines.push(this.buffer.lines[y])
    }

    await writeToClipboard(lines.join('\n'))
    this.buffer.mode = 'NORMAL'
    
    await this.emit('speak', i18n.copied() + i18n.changeToNormalMode())
  }

  async onVisualLineKeydown (ev) {
    switch (ev.key) {
    case 'Escape':
      this.buffer.mode = 'NORMAL'
      await this.emit('speak', i18n.changeToNormalMode())
      break
    case 'y':
      await this.yankVisualLine()
      break
    case 'h':
      this.moveCursor(-1, 0)
      await this.speakStatus()
      break
    case 'l':
      this.moveCursor(1, 0)
      await this.speakStatus()
      break
    case 'j':
      this.moveCursor(0, 1)
      await this.speakStatus()
      break
    case 'k':
      this.moveCursor(0, -1)
      await this.speakStatus()
      break
    } 
  }

  async onCommandKeydown (ev) {
    ev.preventDefault()

    switch (ev.key) {
    case 'Escape':
      this.buffer.mode = 'NORMAL'
      break
    case 'Backspace':
      this.buffer.command = this.buffer.command.substring(0, this.buffer.command.length-1)
      break
    case 'Enter':
      await this.enterCommand()
      break
    default:
      if (isCommandChar(ev.key)) {
        this.buffer.command += ev.key
      }
      break
    }
  }

  async enterCommand () {
    this.buffer.mode = 'NORMAL'
    let scmd = this.buffer.command
    this.buffer.command = ''

    let cmd = new EditorCommand(this.buffer, this.fname)
    let result

    this.error = null

    try {
      cmd.parse(scmd)
    } catch (e) {
      console.error(e)
      this.error = e
      return
    }

    try {
      result = await cmd.exec() 
    } catch (e) {
      console.error(e)
      this.error = e
      return
    }

    switch (result.cmdName) {
    case 'write':
      this.fname = result.fname
      await this.emit('speak', i18n.writedFile())
      break
    case 'read': {
      let lines = result.text.replace('\r\n', '\n').split('\n')
      this.buffer.lines = lines
      this.buffer.cursorX = 0
      this.buffer.cursorY = 0
      this.input.setText(result.text)
      this.fname = result.fname
      await this.emit('speak', i18n.readedFile() + this.getSpeakStatus())
    } break
    case 'quit':
      this.model.refShellMode.value = MODE_FIRST
      await this.emit('speak', i18n.endEditorMode())
      break
    }
  }

  getSpeakStatus () {
    return `${this.buffer.cursorY+1}、${this.buffer.cursorX+1}`
  }

  async speakStatus () {
      await this.emit('speak', this.getSpeakStatus())
  }

  async onNormalKeydown (ev) {
    ev.preventDefault()

    let lastTime = Date.now()
    if (lastTime - this.buffer.lastTime >= 300) {
      this.buffer.lastKeys = [ev.key]
    } else {
      this.buffer.lastKeys.push(ev.key)
    }
    this.buffer.lastTime = lastTime

    switch (ev.key) {
    case ':':
      this.buffer.mode = 'COMMAND'
      break
    case '^':
      this.moveCursorHead()
      this.buffer.lastKeys = []
      break
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
        this.pushUndo()
        this.deleteWord()
        this.buffer.lastKeys = []
        break
      case 'cw':
        this.pushUndo()
        this.buffer.mode = 'INSERT'
        this.deleteWord()
        this.buffer.lastKeys = []
      }
      break
    case 'b':
      switch (this.buffer.lastKeys.join('')) {
      case 'b':
        this.moveCursorWordBack()
        this.buffer.lastKeys = []
        break
      case 'db':
        this.pushUndo()
        this.deleteWordBack()
        this.buffer.lastKeys = []
        break
      }
      break
    case 'd':
      switch (this.buffer.lastKeys.join('')) {
      case 'dd':
        this.pushUndo()
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
      await this.speakStatus()
      break
    case 'ArrowDown':
    case 'j':
      this.moveCursor(0, 1)
      this.buffer.lastKeys = []
      await this.speakStatus()
      break
    case 'ArrowUp':
    case 'k':
      this.moveCursor(0, -1)
      this.buffer.lastKeys = []
      await this.speakStatus()
      break
    case 'ArrowRight':
    case 'l':
      this.moveCursor(1, 0)
      this.buffer.lastKeys = []
      await this.speakStatus()
      break
    case 'I':
      this.startInsertSession()
      this.buffer.mode = 'INSERT'
      this.moveCursorHead()
      this.input.setValue('')
      this.buffer.lastKeys = []        
      break
    case 'i':
      this.startInsertSession()
      this.buffer.mode = 'INSERT'
      this.input.setValue('')
      this.buffer.lastKeys = []        
      break
    case 'a':
      this.startInsertSession()
      this.buffer.mode = 'INSERT'
      this.moveCursor(1, 0)
      this.input.setValue('')
      this.buffer.lastKeys = []
      break
    case 'A':
      this.startInsertSession()
      this.buffer.mode = 'INSERT'
      this.moveCursorTail()
      this.input.setValue('')
      this.buffer.lastKeys = []
      break
    case 'O':
      this.startInsertSession()
      this.buffer.mode = 'INSERT'
      this.insertNewlineUp()
      this.buffer.lastKeys = []
      break
    case 'o':
      this.startInsertSession()
      this.buffer.mode = 'INSERT'
      this.insertNewlineDown()
      this.buffer.lastKeys = []
      break
    case 'Delete':
      this.pushUndo()
      this.deleteCharAndJoin()
      this.buffer.lastKeys = []
      break
    case 'x':
      this.pushUndo()
      this.deleteChar()
      this.moveCursor(-1, 0)
      this.buffer.lastKeys = []
      break
    case 'u':
      if (ev.ctrlKey) {
        this.moveCursor(0, -10)
        this.buffer.lastKeys = []
      } else {
        this.undo()
      }
      break
    case 'r':
      if (ev.ctrlKey) {
        this.redo()
      }
      break
    case 'V':
      this.buffer.mode = 'VISUAL LINE'
      this.buffer.visualLineStartCursorY = this.buffer.cursorY
      this.emit('speak', i18n.changeToViauslLineMode())
      break
    case 'p':
      await this.paste()
      break
    }
  }

  async paste () {
    let y = this.buffer.cursorY
    let text = await readFromClipboard()
    let lines = text.replace('\r\n', '\n').split('\n')

    this.buffer.lines.splice(y+1, 0, ...lines)
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
    case 'Tab':
      this.insertChar('\t')
      break
    case 'Delete':
      this.deleteCharAndJoin()
      this.buffer.lastKeys = []
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
    this.endInsertSession()
    this.buffer.mode = 'NORMAL'
    this.input.setValue('')
  }

  async onEditorInput (text) {
    switch (this.buffer.mode) {
    default:
      break
    case 'INSERT':
      if (!text.length) {
        return
      }

      for (let ch of text) {
        this.insertChar(ch)
      }

      this.buffer.isEdited = true
      this.input.setValue('')
      this.render()
      break
    }
  }

  escapeText (text) {
    let s = ''

    for (let i = 0; i < text.length; i++) {
      let c = text[i]
      switch (c) {
      case '<':
        s += '&lt;'
        break
      case '>':
        s += '&gt;'
        break
      case '&':
        s += '&amp;'
        break
      case '"':
        s += '&quot;'
        break
      case "'":
        s += '&#39;'
        break
      case ' ':
        s += '&nbsp;'
        break
      default:
        s += c
        break
      }
    }

    return s
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

        line = this.escapeText(left) + `<span class="editor-cursor">${cur}</span>` + this.escapeText(right)
      } else {
        line = this.escapeText(line)
      }
      if (line === '') {
        line = ' '
      }

      out.push(line)
    }

    this.renderLayer.setHTML(
      out.join('\n')
    )

    switch (this.buffer.mode) {
    case 'COMMAND':
      this.statusBar.setText(`:${this.buffer.command}`)
      break
    default: {
      let fname = this.fname
      if (fname == null) {
        fname = ''
      }
      // alert(this.fname)
      this.statusBar.setText(
        `${this.buffer.mode} ${fname} ${this.buffer.cursorY+1}:${this.buffer.cursorX+1}`
      )
    } break
    }
    if (this.error) {
      this.statusBar.setText(''+this.error)
    }
  }

  moveCursorHead () {
    this.buffer.cursorX = 0
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
  
  deleteCharAndJoin () {
    let x = this.buffer.cursorX
    let y = this.buffer.cursorY
    let line = this.buffer.lines[y]
    if (x === line.length) {
      // join
      let line2 = this.buffer.lines[y+1]
      if (line2) {
        this.buffer.lines[y] = line.slice(0, x) + line2.slice(0)
        this.buffer.lines.splice(y+1, 1)
      }
    } else {
      this.deleteChar()
    }
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

  async setup (args) {
    this.notebook.clear()

    if (!args.length) {
      args = [null]
    }

    for (let fname of args) {
      let page = new EditorPage(this.model, fname)
      if (fname == null) {
        fname = 'empty'
      }

      try {
        await page.load()
      } catch (e) {
        console.error(e)
        continue
      }

      let tab = new nue.NotebookTab(fname, page)
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
    default:
      await this.emit(key, val)
      break
    case 'quitEditor':
      this.hide()
      this.model.refShellMode.value = MODE_FIRST
      break
    }
  }
}
