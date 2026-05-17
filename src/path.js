export class Path {
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

