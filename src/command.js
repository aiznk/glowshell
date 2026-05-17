const { invoke } = window.__TAURI__.core;
import {
  isIdent, isIdentHead,
} from './utils.js'

export class CommandResult {
  constructor () {
    this.cmdName = null /* String */
    this.cwd = null /* String */
    this.files = [] /* Vec<String> */
    this.text = null /* String */
    this.exitStatus = 0 /* i32 */
    this.error = null /* Error */
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
    case 'cat': return await this.execCat(result); break
    case 'cd': return await this.execCd(result); break
    case 'ls': return await this.execLs(result); break
    }
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
