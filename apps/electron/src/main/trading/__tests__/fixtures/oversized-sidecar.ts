process.stdin.once('data', () => process.stdout.write('x'.repeat(256)))
setInterval(() => {}, 1_000)
