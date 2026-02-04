const { invoke } = window.__TAURI__.core;
import * as nue from './nue/nue.js'

class Root extends nue.Root {
  constructor () {
    super()
    this.setText('Hello')
  }
}

window.addEventListener("DOMContentLoaded", () => {
  let root = new Root()
  root.mount('#app')
  invoke('speak', { text: 'こんにちは、世界。' })
});
