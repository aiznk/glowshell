const { invoke } = window.__TAURI__.core;
import {
  isIdent, isIdentHead,
  fixSpeakText,
} from './utils.js'
import {
  MODE_HELP,
} from './consts.js'
import i18n from './i18n.js'

export class CommandResult {
  constructor () {
    this.cmdName = null /* String */
    this.cwd = null /* String */
    this.files = [] /* Vec<String> */
    this.text = null /* String */
    this.exitStatus = 0 /* i32 */
    this.error = null /* Error */
    this.args = [] /* Vec */
  }
}

export class Command {
  constructor (model) {
    this.model = model
    this.name = ''
    this.args = []
  }

  async exec (result=null /* CommandResult */) {
    switch (this.name) {
    case 'help': return await this.execHelp(result); break
    case 'cat': return await this.execCat(result); break
    case 'lcat': return await this.execLcat(result); break
    case 'cd': return await this.execCd(result); break
    case 'ls': return await this.execLs(result); break
    case 'touch': return await this.execTouch(result); break
    case 'rm': return await this.execRm(result); break
    case 'mkdir': return await this.execMkdir(result); break
    case 'pwd': return await this.execPwd(result); break
    case 'vi': return await this.execEditor(result); break
    }
  }

  async execEditor (_) {
    let ret = new CommandResult()
    ret.cmdName = 'vi'
    ret.args = this.args
    return ret
  }

  async execPwd (_) {
    let ret = new CommandResult()
    ret.cmdName = 'pwd'

    try {
      ret.text = await invoke('cmd_pwd')
    } catch (e) {
      ret.exitStatus = 1
      ret.error = e
      return ret
    }

    let pwd = fixSpeakText(ret.text.trim()).split('').join(' ')
    return this.unsyncSpeak(ret, i18n.donePwd(pwd))
  }

  async execMkdir (_) {
    let ret = new CommandResult()
    ret.cmdName = 'mkdir'

    if (!this.args.length) {
      ret.exitStatus = 1
      ret.error = i18n.invalidArgs()
      return ret      
    }

    try {
      await invoke('cmd_mkdir', {
        args: this.args,
      })
    } catch (e) {
      ret.exitStatus = 1
      ret.error = e
      return ret
    }

    return this.unsyncSpeak(ret, i18n.doneMkdir())
  }

  async execTouch (_) {
    let ret = new CommandResult()
    ret.cmdName = 'touch'

    if (!this.args.length) {
      ret.exitStatus = 1
      ret.error = i18n.invalidArgs()
      return ret      
    }

    try {
      await invoke('cmd_touch', {
        args: this.args,
      })
    } catch (e) {
      ret.exitStatus = 1
      ret.error = e
      return ret
    }

    return this.unsyncSpeak(ret, i18n.doneTouch())
  }

  async execRm (_) {
    let ret = new CommandResult()
    ret.cmdName = 'rm'

    if (!this.args.length) {
      ret.exitStatus = 1
      ret.error = i18n.invalidArgs()
      return ret
    }

    try {
      await invoke('cmd_rm', {
        args: this.args,
      })
    } catch (e) {
      ret.exitStatus = 1
      ret.error = e
      return ret
    }

    return this.unsyncSpeak(ret, i18n.doneRm())
  }

  async unsyncSpeak (result /* CommandResult */, text) {
    try {
      /* await */ invoke('speak', { text })
    } catch (e) {
      console.error(e)
      result.exitStatus = 1
      result.error = e
      return result
    }      
    return result
  }

  async execHelp (_) {
    let ret = new CommandResult()
    ret.cmdName = 'help'
    ret.exitStatus = 0

    if (!this.args.length) {
      ret = await this.unsyncSpeak(ret, i18n.helpDesc())
      this.model.refShellMode.value = MODE_HELP
      return ret
    }

    let cmdName = this.args[0]

    switch (cmdName) {
    case 'ls': return this.unsyncSpeak(ret, i18n.helpLs()); break
    case 'cd': return this.unsyncSpeak(ret, i18n.helpCd()); break
    case 'cat': return this.unsyncSpeak(ret, i18n.helpCat()); break
    case 'lcat': return this.unsyncSpeak(ret, i18n.helpLcat()); break
    case 'rm': return this.unsyncSpeak(ret, i18n.helpRm()); break
    case 'touch': return this.unsyncSpeak(ret, i18n.helpTouch()); break
    case 'mkdir': return this.unsyncSpeak(ret, i18n.helpMkdir()); break
    default: return this.unsyncSpeak(ret, i18n.unknownCmdName()); break
    }
  }

  async execLcat (result) {
    let ret = new CommandResult()
    ret.cmdName = 'lcat'    

    let files = this.model.refFiles.value
    let ifiles = []

    for (let arg of this.args) {
      let i = parseInt(arg)
      if (isNaN(i)) {
        continue
      }
      if (i >= 0 && i < files.length) {
        ifiles.push(files[i])
      } else {
        continue
      }
    }

    if (!ifiles.length) {
      ret.exitStatus = 1
      ret.error = '参照できるファイルがありません。'
      return ret
    }

    try {
      ret.text = await invoke('cmd_cat', {
        args: ifiles,
      })
    } catch (e) {
      console.error(e)
      ret.exitStatus = 1
      ret.error = e
      return ret
    }

    ret.exitStatus = 0
    return ret
  }

  async execCat (result) {
    let ret = new CommandResult()
    ret.cmdName = 'cat'

    if (!this.args.length) {
      return ret
    }

    try {
      ret.text = await invoke('cmd_cat', {
        args: this.args,
      })
    } catch (e) {
      console.error(e)
      ret.exitStatus = 1
      ret.error = e
      return ret
    }

    ret.exitStatus = 0
    return ret
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
      ret.exitStatus = 1
      ret.error = e
      return ret
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
      ret.error = e
      return ret
    }

    ret.cmdName = 'cd'
    ret.cwd = cwd
    ret.exitStatus = 0
    return ret
  }
}

export class CommandLine {
  constructor (model) {
    this.model = model
    this.commands = []
  }

  async exec () {
    let ret = new CommandResult()
    let prevCmd

    for (let i = 0; i < this.commands.length; i++) {
      let cmd = this.commands[i]
      if (cmd.name === '|' || cmd.name === '&&') {
        prevCmd = cmd
        continue
      }
      if (prevCmd && prevCmd.name === '|') {
        ret = await cmd.exec(ret)
      } else if (prevCmd && prevCmd.name === '&&') {
        if (ret.exitStatus !== 0) {
          break
        }
        ret = await cmd.exec()
      } else {
        ret = await cmd.exec()
      }
      prevCmd = cmd
    }

    return ret
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
