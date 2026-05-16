const { invoke } = window.__TAURI__.core;
const { listen, emit } = window.__TAURI__.event;
import * as nue from './nue/nue.js'

function showError (s) {
  alert(s)
}

class MainModel {
  constructor () {
    this.refCwd = nue.ref(null)
    this.refCwdFiles = nue.ref([])
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

class ShellSep extends nue.Label {
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

    this.add(new ShellRow(this.model))
  }

  setFirstLabelCwd (cwd) {
    this.children[0].setLabelCwd(cwd)
  }

  receive (key, val) {
    switch (key) {
    case 'enterShellInput':
      this.updateByCmdLine(val)
      break
    }
  }

  updateByCmdLine (cmdLine) {
    let tailRow = this.children[this.children.length-1]
    let oldCwd = tailRow.getLabelCwd()
    let newRow = new ShellRow(this.model)

    tailRow.flozen()
    newRow.setLabelCwd(oldCwd)
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
  }

  async setup () {
    await listen('done_speak', this.onDoneSpeak.bind(this))
    await this.getCwd()
    await this.listCwdDir()
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

  async listCwdDir () {
    try {
      this.model.refCwdFiles.value = await invoke('list_cwd')
    } catch (e) {
      console.error(e)
      return showError(e)
    } 
  }

  async onDoneSpeak (ev) {
    console.log(ev)
  }
}

window.addEventListener("DOMContentLoaded", async () => {
  let root = new Root()
  await root.setup()
  root.mount('#app')
  
  try {
    await invoke('speak', { text: 'こんにちは、世界。' })
  } catch (e) {
    console.error(e)
    return
  }

  // setTimeout(() => {
  //   emit('stop_speak')
  // }, 500)
});
