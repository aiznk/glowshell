const { invoke } = window.__TAURI__.core;
const { listen, emit } = window.__TAURI__.event;
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
import {Command, CommandLine, CommandResult} from './command.js'
import {Path} from './path.js'
import {showError, fixSpeakText} from './utils.js'
import * as nue from './nue/nue.js'

class MainModel {
  constructor () {
    this.refShellMode = nue.ref(MODE_FIRST)
    this.refCwd = nue.ref(null)
    this.refFiles = nue.ref([])
    this.refText = nue.ref('')
    this.refProcStep = nue.ref(0)
    this.refEditorArgs = nue.ref([])
  }
}

class ShellInput extends nue.Input {
  constructor (model) {
    super({
      class: 'shell-input',
    }, {
      events: ['keydown'],
    })

    this.model = model
  }

  focus () {
    this.elem.focus()
  }

  enter () {
    this.emit('enterShellInput', this.getValue())
  }

  async onKeydown (ev) {
    switch (ev.code) {
    default:
      if (!this.getValue().length && ev.code === 'Backspace') {
        await this.emit('isEmptyShellInput', ev)
      } else {
        await this.emit('keydownShellInput', ev)
      }
      break
    case 'NumpadEnter':
    case 'Enter':
      this.enter()
      break
    }
  }
}

class ShellLabel extends nue.Label {
  constructor (model) {
    super()
    this.model = model
  }

  setCwd (cwd) {
    this.setText(cwd)
  }
}

class ShellSep extends nue.Span {
  constructor (text) {
    super()
    this.setText(text)
  }
}

class ShellRow extends nue.Div {
  constructor (model) {
    super()
    this.model = model

    this.label = new ShellLabel(this.model)
    this.add(this.label)

    this.sep = new ShellSep('$')
    this.add(this.sep)

    this.input = new ShellInput(this.model)
    this.add(this.input)
  }

  focus () {
    this.input.focus()
  }

  getLabelCwd () {
    return this.label.getText()
  }

  flozen () {
    let value = this.input.getValue()
    this.remove(this.input)
    this.input = new nue.Label()
    this.input.setText(value)
    this.add(this.input)
  }

  setLabelCwd (cwd) {
    this.label.setCwd(cwd)
  }
}

class Shell extends nue.Div {
  constructor (model) {
    super()
    this.model = model

    let row = new ShellRow(this.model)
    this.add(row)
    setTimeout(() => {
      row.focus()
    }, 1000)
  }

  focus () {
    this.children[this.children.length-1].focus()
  }

  setFirstLabelCwd (cwd) {
    this.children[0].setLabelCwd(cwd)
  }

  async receive (key, val) {
    switch (key) {
    default: this.emit(key, val); break
    case 'enterShellInput':
      await this.updateByCmdLine(val)
      break
    }
  }

  async updateByCmdLine (sCmdLine) {
    let tailRow = this.children[this.children.length-1]
    let newCwd = tailRow.getLabelCwd()
    let newRow = new ShellRow(this.model)

    let cmdLine = new CommandLine(this.model)
    cmdLine.parse(sCmdLine)
    
    let result = await cmdLine.exec()
    
    tailRow.flozen()

    switch (result.cmdName) {
    case 'vi': {
      this.model.refShellMode.value = MODE_EDITOR
      this.model.refEditorArgs.value = result.args
    } break
    case 'cd': {
      if (result.cwd) {
        newCwd = result.cwd
        this.model.refCwd.value = newCwd
        this.model.refShellMode.value = MODE_DONE_CD
      }
    } break
    case 'ls': {
      let text = result.files.join(' ')
      let p = new nue.P()
      p.setText(text)
      this.add(p)
      this.model.refFiles.value = result.files
      this.model.refShellMode.value = MODE_HAS_LIST_FILES
    } break
    case 'cat':
    case 'lcat': {
      if (result.text) {
        this.model.refText.value = result.text
        this.model.refShellMode.value = MODE_DONE_CAT      
        for (let line of result.text.replace('\r\n', '\n').split('\n')) {
          let p = new nue.P()
          p.setText(line)
          this.add(p)
        }
      }
    } break
    case 'pwd': {
      let p = new nue.P()
      p.setText(result.text.trim())
      this.add(p)
    } break
    }

    newRow.setLabelCwd(newCwd)
    this.add(newRow) 
    newRow.focus()

    if (result.exitStatus !== 0) {
      await this.emit('speak', i18n.failedCommandExec(result.error))
    }
  }
}

class EditorNotebook extends nue.Notebook {
  constructor (model) {
    super({ class: 'editor-notebook' })
    this.model = model
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

    case 'x':
      this.deleteChar()
      break
    }
  }

  async onInsertKeydown (ev) {
    switch (ev.key) {
    case 'Escape':
      ev.preventDefault()

      this.buffer.mode = 'NORMAL'

      this.input.setValue('')

      return

    case 'Backspace':
      ev.preventDefault()

      this.backspace()

      this.input.setValue('')

      return

    case 'Enter':
      ev.preventDefault()

      this.insertNewline()

      this.input.setValue('')

      return
    }
  }

  async onEditorInput (text) {
    if (
      this.buffer.mode !== 'INSERT'
    ) {
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

    for (
      let y = 0;
      y < this.buffer.lines.length;
      y++
    ) {
      let line =
        this.buffer.lines[y]

      if (y === this.buffer.cursorY) {
        let x =
          this.buffer.cursorX

        let left =
          line.slice(0, x)

        let cur =
          line[x] || ' '

        let right =
          line.slice(x + 1)

        line =
          left +
          `<span class="cursor">${cur}</span>` +
          right
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

    let line =
      this.buffer.lines[
        this.buffer.cursorY
      ]

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

    let line =
      this.buffer.lines[y]

    this.buffer.lines[y] =
      line.slice(0, x) +
      ch +
      line.slice(x)

    this.buffer.cursorX++
  }

  deleteChar () {
    let y = this.buffer.cursorY
    let x = this.buffer.cursorX

    let line =
      this.buffer.lines[y]

    if (x >= line.length) {
      return
    }

    this.buffer.lines[y] =
      line.slice(0, x) +
      line.slice(x + 1)
  }

  backspace () {
    let y = this.buffer.cursorY
    let x = this.buffer.cursorX

    if (x <= 0) {
      return
    }

    let line =
      this.buffer.lines[y]

    this.buffer.lines[y] =
      line.slice(0, x - 1) +
      line.slice(x)

    this.buffer.cursorX--
  }

  insertNewline () {
    let y = this.buffer.cursorY
    let x = this.buffer.cursorX

    let line =
      this.buffer.lines[y]

    let left =
      line.slice(0, x)

    let right =
      line.slice(x)

    this.buffer.lines[y] = left

    this.buffer.lines.splice(
      y + 1,
      0,
      right
    )

    this.buffer.cursorY++
    this.buffer.cursorX = 0
  }
}

class EditorBuffer {
  constructor () {
    this.lines = ['']
    this.cursorX = 0
    this.cursorY = 0
    this.mode = 'NORMAL'
    this.path = null
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

class Editor extends nue.Div {
  constructor (model) {
    super({ class: 'editor' })

    this.model = model

    this.notebook =
      new EditorNotebook(this.model)

    this.add(this.notebook)
  }

  setup (args) {
    this.notebook.clear()

    if (!args.length) {
      args = ['empty']
    }

    for (let arg of args) {
      let page = new EditorPage(this.model, arg)

      let tab =
        new nue.NotebookTab(arg, page)

      this.notebook.addTab(tab)
    }

    this.notebook.click(0)

    setTimeout(() => {
      let tab =
        this.notebook.tabs.children[0]

      alert(tab.component.focus())
    }, 100)
  }

  async receive (key, val) {
    switch (key) {
    case 'quitEditor':
      this.hide()
      this.model.refShellMode.value =
        MODE_FIRST
      break
    }
  }
}

class Root extends nue.Root {
  constructor () {
    super()
    this.model = new MainModel()
    
    this.shell = new Shell(this.model)
    this.add(this.shell)

    this.editor = new Editor(this.model)
    this.editor.hide()
    this.add(this.editor)

    window.addEventListener('keydown', this.onWindowKeydown.bind(this))
    window.addEventListener('focus', this.onWindowFocus.bind(this))
    window.addEventListener('blur', this.onWindowBlur.bind(this))
    this.model.refShellMode.onSet(this.onChangeShellMode.bind(this))
  }

  async onChangeShellMode (old, mode) {
    switch (mode) {
    case MODE_EDITOR:
      this.shell.hide()
      this.editor.setup(this.model.refEditorArgs.value)
      this.editor.show()
      break
    case MODE_HAS_LIST_FILES:
      await this.speak(i18n.speakHasListFiles(this.model.refFiles.value))
      break
    case MODE_DONE_CD: {
      await this.speak(i18n.doneCd())
    } break
    case MODE_DONE_CAT:
      await this.speak(i18n.doneCat()) 
      break
    }
  }

  async onWindowFocus () {
    if (DEBUG) {
      return
    }
    try {
      await this.speak(i18n.focusedWindow())
    } catch (e) {
      console.error(e)
      return 
    }
  }

  async onWindowBlur () {
    if (DEBUG) {
      return
    }
    try {
      await this.speak(i18n.bluredWindow())
    } catch (e) {
      console.error(e)
      return 
    }    
  }

  async speakListFiles () {
    let files = this.model.refFiles.value
    let step = this.model.refProcStep.value

    if (!files.length) {
      await this.speak(i18n.filesIsEmpty())
      return
    }

    await this.speak(i18n.speakStartListFiles())

    for (let i = 0; i < files.length; i++) {
      await this.speak(i18n.speakFileNumber(i))

      let file = files[i]
      file = fixSpeakText(file)

      // 2026-05-17: 英単語の読み上げが微妙だったので文字を1つずつ
      // 発音させるようにしている。
      file = file.split('').join(' ')

      await this.speak(file)
      if (step !== this.model.refProcStep.value) {
        break
      }
    }
  }

  async speakText () {
    let text = fixSpeakText(this.model.refText.value).trim()
    text = text.length ? text : i18n.textIsEmpty()

    try {
      await this.speak(text)
    } catch (e) {
      console.error(e)
      return
    }
  }

  async onWindowKeydown (ev) {
    switch (ev.code) {
    case 'KeyH':
      if (ev.ctrlKey) {
        this.model.refShellMode.value = MODE_HELP
        await this.speak(i18n.helpDesc())
      }
      break
    case 'KeyC':
      if (ev.ctrlKey) {
        this.model.refProcStep.value += 1
        await this.speak(i18n.cancelled())
      }
      break
    case 'KeyI':
      if (ev.ctrlKey) {
        this.shell.focus()
        await this.speak(i18n.focusedCmdLineInput())
      }
      break
    case 'Escape':
      await this.stopSpeak()
      break
    }

    switch (this.model.refShellMode.value) {
    case MODE_HELP:
      switch (ev.code) {
      case 'Digit1': await this.speak(i18n.appAbout()); break
      case 'Digit2': await this.speak(i18n.commandHelp()); break
      }
      break
    case MODE_HAS_LIST_FILES:
      switch (ev.code) {
      case 'KeyQ':
        if (ev.ctrlKey) {
          await this.speakListFiles()
        }
        break
      }
      break
    case MODE_DONE_CAT:
      switch (ev.code) {
      case 'KeyQ':
        if (ev.ctrlKey) {
          await this.speakText()
        }
        break
      }
      break
    }
  }

  async setup () {
    await listen('done_speak', this.onDoneSpeak.bind(this))
    await this.getCwd()
  }

  async stopSpeak () {
    await emit('stop_speak')
  }

  async speak (text) {
    await emit('stop_speak')
    try {
      await invoke('speak', { text })
    } catch (e) {
      console.error(e)
      return
    }
  }

  async receive (key, val) {
    switch (key) {
    case 'isEmptyShellInput':
      await this.speak(i18n.isEmptyShellInput())
      break
    case 'keydownShellInput':
      await this.speak(fixSpeakText(val.key))
      break
    case 'speak': await this.speak(val); break
    }
  }

  async getCwd () {
    try {
      this.model.refCwd.value = await invoke('cwd')
    } catch (e) {
      console.error(e)
      return showError(e)
    }

    this.shell.setFirstLabelCwd(this.model.refCwd.value)
  }

  async onDoneSpeak (ev) {
    // console.log(ev)
  }
}

function testCommandLine () {
  let cmdLine
  let cmds

  cmdLine = new CommandLine()
  cmds = cmdLine.parse('cd')
  console.assert(cmds.length === 1)
  console.assert(cmds[0].name === 'cd')

  cmdLine = new CommandLine()
  cmds = cmdLine.parse('cat f1.txt f2.txt')
  console.assert(cmds.length === 1)
  console.assert(cmds[0].name === 'cat')
  console.assert(cmds[0].args.length === 2)
  console.assert(cmds[0].args[0] === 'f1.txt')
  console.assert(cmds[0].args[1] === 'f2.txt')

  cmdLine = new CommandLine()
  cmds = cmdLine.parse('cat f1.txt | echo 123')
  console.assert(cmds.length === 3)
  console.assert(cmds[0].name === 'cat')
  console.assert(cmds[0].args.length === 1)
  console.assert(cmds[0].args[0] === 'f1.txt')
  console.assert(cmds[1].name === '|')
  console.assert(cmds[2].name === 'echo')
  console.assert(cmds[2].args.length === 1)
  console.assert(cmds[2].args[0] === '123')

  cmdLine = new CommandLine()
  cmds = cmdLine.parse('cat f1.txt && echo 123')
  console.assert(cmds.length === 3)
  console.assert(cmds[0].name === 'cat')
  console.assert(cmds[0].args.length === 1)
  console.assert(cmds[0].args[0] === 'f1.txt')
  console.assert(cmds[1].name === '&&')
  console.assert(cmds[2].name === 'echo')
  console.assert(cmds[2].args.length === 1)
  console.assert(cmds[2].args[0] === '123')
}

function test () {
  testCommandLine()
  console.log('test done')
}

window.addEventListener("DOMContentLoaded", async () => {
  test()
  let root = new Root()
  await root.setup()
  root.mount('#app')
});
