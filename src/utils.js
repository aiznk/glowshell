export function isAlpha (c) {
  return /[a-zA-Z]/.test(c)
}

export function isIdentHead (c) {
  return /[a-zA-Z_]/.test(c)
}

export function isIdent (c) {
  return /[a-zA-Z0-9_]/.test(c)
}

export function showError (s) {
  alert(s)
}

export function fixSpeakText (text) {
  return text
    .replace(/\./g, 'ドット')
    .replace(/\:/g, 'コロン')
    .replace(/\-/g, 'ハイフン')
    .replace(/ /g, 'スペース')
}

export async function readFromClipboard () {
  return new Promise((resolve, reject) => {
    navigator.clipboard.readText().then(text => {
      resolve(text)
    })
  })
}

export async function writeToClipboard (text) {
  return new Promise((resolve, reject) => {
    navigator.clipboard.writeText(text).then(() => {
      resolve()
    }, () => {
      reject()
    })
  })
}
