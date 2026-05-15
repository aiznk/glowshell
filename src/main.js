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

class Root extends nue.Root {
  constructor () {
    super()
    this.model = new MainModel()
    this.setText('Hello')
  }

  async setup () {
    await listen('done_speak', this.onDoneSpeak.bind(this))
    await this.getCwd()
    await this.listCwdDir()
    this.setText(this.model.refCwd.value)
  }

  async getCwd () {
    try {
      this.model.refCwd.value = await invoke('cwd')
    } catch (e) {
      console.error(e)
      return showError(e)
    }
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
