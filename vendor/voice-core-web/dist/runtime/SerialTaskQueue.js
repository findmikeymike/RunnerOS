export class SerialTaskQueue {
    tail = Promise.resolve();
    run(operation) {
        const result = this.tail.catch(() => undefined).then(operation);
        this.tail = result.then(() => undefined, () => undefined);
        return result;
    }
}
//# sourceMappingURL=SerialTaskQueue.js.map