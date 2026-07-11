process.stdin.once('data', () => {
  process.stderr.write('e'.repeat(128))
  setTimeout(() => process.exit(19), 10)
})
