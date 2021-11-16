const foo = require('./esm-function.js');
const Foo = require('./esm-constructor.js');

t.is(foo.bar, 'bar');
t.is(foo.default(), 'foo');
t.is(foo(), 'foo');

t.is(Foo.bar, 'bar');

// eslint-disable-next-line new-cap
const newDefault = new Foo.default();
t.is(newDefault.foo, 'foo');
newDefault.update();
t.is(newDefault.foo, 'updated');

const newFoo = new Foo();
t.is(newFoo.foo, 'foo');
newFoo.update();
t.is(newFoo.foo, 'updated');
