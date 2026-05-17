const { invoke } = window.__TAURI__.core;
const { listen, emit } = window.__TAURI__.event;
import {
  MODE_FIRST,
  MODE_HAS_LIST_FILES,
} from './consts.js'
import i18n from './i18n.js'
import * as nue from './nue/nue.js'

function showError (s) {
  alert(s)
}

function fixSpeakText (text) {
  return text.replace(/\./g, 'ドット') 
}

class MainModel {
  constructor () {
    this.refShellMode = nue.ref(MODE_FIRST)
    this.refCwd = nue.ref(null)
    this.refFiles = nue.ref([])
    this.refProcStep = nue.ref(0)
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

  onKeydown (ev) {
    switch (ev.code) {
    default:
      this.emit('keydownShellInput', ev)
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

function isAlpha (c) {
  return /[a-zA-Z]/.test(c)
}

function isIdentHead (c) {
  return /[a-zA-Z_]/.test(c)
}

function isIdent (c) {
  return /[a-zA-Z0-9_]/.test(c)
}

class Path {
  constructor (path) {
    this.path = path
  }

  parent () {
    let toks = this.parse(this.path)
    if (toks.length) {
      toks.pop()
    }
    return this.join(toks)
  }

  parse (path) {
    path = path.replace('\\', '/')
    return path.split('/')
  }

  join (toks) {
    return toks.join('\\')
  }
}

class CommandResult {
  constructor () {
    this.cmdName = null
    this.cwd = null
    this.files = []
    this.exitStatus = 0
  }
}

class Command {
  constructor (model) {
    this.model = model
    this.name = ''
    this.args = []
  }

  async exec (result=null /* CommandResult */) {
    switch (this.name) {
    case 'cat': return await this.execCat(result); break
    case 'cd': return await this.execCd(result); break
    case 'ls': return await this.execLs(result); break
    }
  }

  async execCat (result) {

  }

  async execLs (result) {
    let ret = new CommandResult()
    let arg = this.args.length ? this.args[0] : null

    try {
      ret.files = await invoke('cmd_ls', {
        arg,
      })
    } catch (e) {
      console.error(e)
      showError(e)
      result.exitStatus = 1
      return result
    }

    ret.cmdName = 'ls'
    ret.exitStatus = 0
    return ret
  }

  async execCd (result) {
    let ret = new CommandResult()
    let arg = this.args.length ? this.args[0] : null
    let path
    let cwd

    try {
      cwd = await invoke('cmd_cd', {
        arg,
      })
    } catch (e) {
      console.error(e)
      ret.exitStatus = 1
      return ret
    }

    ret.cmdName = 'cd'
    ret.cwd = cwd
    ret.exitStatus = 0
    return ret
  }
}

class CommandLine {
  constructor (model) {
    this.model = model
    this.commands = []
  }

  async exec () {
    let result = new CommandResult()
    let prevCmd

    for (let i = 0; i < this.commands.length; i++) {
      let cmd = this.commands[i]
      if (cmd.name === '|' || cmd.name === '&&') {
        prevCmd = cmd
        continue
      }
      if (prevCmd && prevCmd.name === '|') {
        result = await cmd.exec(result)
      } else if (prevCmd && prevCmd.name === '&&') {
        if (result.exitStatus !== 0) {
          break
        }
        result = await cmd.exec()
      } else {
        result = await cmd.exec()
      }
      prevCmd = cmd
    }

    return result
  }

  parse (s) {
    let m = 0
    let buf = ''
    let cmd = null
    s = s.trim()

    for (let i = 0; i < s.length; i++) {
      let c = s[i]
      switch (m) {
      case 0:
        if (isIdentHead(c)) {
          buf += c
          m = 10
        }
        break
      case 10:
        if (c === ' ') {
          cmd = new Command(this.model)
          cmd.name = buf
          buf = ''
          m = 20
        } else {
          buf += c
        }
        break
      case 20:
        if (c === ' ') {
          cmd.args.push(buf)
          buf = ''
        } else if (c === '&') {
          if (i+1 < s.length) {
            let c2 = s[i+1]
            i++
            if (c2 === '&') {
              this.commands.push(cmd)
              cmd = new Command(this.model)
              cmd.name = '&&'
              this.commands.push(cmd)
              m = 0
            }
          } 
        } else if (c === '|') {
          this.commands.push(cmd)
          cmd = new Command(this.model)
          cmd.name = '|'
          this.commands.push(cmd)
          m = 0
        } else {
          buf += c
        }
        break
      }
    }

    if (buf.length) {
      if (m === 10) {
        cmd = new Command(this.model)
        cmd.name = buf
        this.commands.push(cmd)
      } else if (m === 20) {
        cmd.args.push(buf)
        this.commands.push(cmd)
      }
    }

    return this.commands
  }
}

class Shell extends nue.Div {
  constructor (model) {
    super()
    this.model = model

    this.add(new ShellRow(this.model))
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
    
    if (result.cwd) {
      newCwd = result.cwd
    }

    tailRow.flozen()

    if (result.files.length) {
      let text = result.files.join(' ')
      let p = new nue.P()
      p.setText(text)
      this.add(p)
      this.model.refFiles.value = result.files
      this.model.refShellMode.value = MODE_HAS_LIST_FILES
    }

    newRow.setLabelCwd(newCwd)
    this.add(newRow) 
    newRow.focus()
  }
}

class Root extends nue.Root {
  constructor () {
    super()
    this.model = new MainModel()
    
    this.shell = new Shell(this.model)
    this.add(this.shell)

    window.addEventListener('keydown', this.onWindowKeydown.bind(this))

    this.model.refShellMode.onSet(async (old, mode) => {
      switch (mode) {
      case MODE_HAS_LIST_FILES:
        await this.speak(i18n.speakHasListFiles())
        break
      }
    })
  }

  async speakListFiles () {
    let files = this.model.refFiles.value
    let step = this.model.refProcStep.value

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

  async onWindowKeydown (ev) {
    switch (ev.code) {
    case 'KeyC':
      if (ev.ctrlKey) {
        this.model.refProcStep.value += 1
      }
      break
    case 'Escape':
      await this.stopSpeak()
      break
    }

    switch (this.model.refShellMode.value) {
    case MODE_HAS_LIST_FILES:
      switch (ev.code) {
      case 'F2':
        await this.speakListFiles()
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
    case 'keydownShellInput': {
      await this.speak(fixSpeakText(val.key))
    } break
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
    console.log(ev)
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
  
  // try {
  //   await invoke('speak', { text: 'こんにちは、世界。' })
  // } catch (e) {
  //   console.error(e)
  //   return
  // }

  // setTimeout(() => {
  //   emit('stop_speak')
  // }, 500)
});
