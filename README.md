# jano-plugin-toml

TOML syntax highlighting plugin for [jano editor](https://janoeditor.dev).

## Features

- Table headers (`[table]`, `[[array.of.tables]]`)
- Keys, also dotted (`a.b.c`) and quoted (`"my key"`), inside inline tables too
- Basic and literal strings, multi-line strings (`"""` and `'''`) across lines
- Numbers (separators, hex, octal, binary, exponents, `inf`, `nan`)
- Dates and times, booleans, comments
- Auto-indent on Enter inside open arrays and inline tables

## Install

```bash
jano plugin install toml
```

## Supported Files

- `.toml`

## License

MIT
