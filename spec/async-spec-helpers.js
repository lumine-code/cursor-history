function beforeEach(fn) {
  global.beforeEach(function () {
    const result = fn();
    if (result instanceof Promise) waitsForPromise(() => result);
  });
}

function afterEach(fn) {
  global.afterEach(function () {
    const result = fn();
    if (result instanceof Promise) waitsForPromise(() => result);
  });
}

["it", "fit", "ffit", "fffit"].forEach(function (name) {
  module.exports[name] = function (description, fn) {
    if (fn === undefined) {
      global[name](description);
      return;
    }
    global[name](description, function () {
      const result = fn();
      if (result instanceof Promise) waitsForPromise(() => result);
    });
  };
});

async function conditionPromise(condition) {
  const startTime = Date.now();
  while (true) {
    await timeoutPromise(100);
    if (await condition()) return;
    if (Date.now() - startTime > 5000) throw new Error("Timed out waiting on condition");
  }
}

function timeoutPromise(timeout) {
  return new Promise((resolve) => global.setTimeout(resolve, timeout));
}

function waitsForPromise(fn) {
  const promise = fn();
  global.waitsFor("spec promise to resolve", function (done) {
    promise.then(done, function (error) {
      jasmine.getEnv().currentSpec.fail(error);
      done();
    });
  });
}

function emitterEventPromise(emitter, event, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const timeoutHandle = setTimeout(() => {
      reject(new Error(`Timed out waiting for '${event}' event`));
    }, timeout);
    emitter.once(event, () => {
      clearTimeout(timeoutHandle);
      resolve();
    });
  });
}

Object.assign(module.exports, {
  afterEach,
  beforeEach,
  conditionPromise,
  emitterEventPromise,
  timeoutPromise,
});
