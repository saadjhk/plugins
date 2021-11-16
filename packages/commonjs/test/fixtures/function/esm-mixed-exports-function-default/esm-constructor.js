export default function Foo() {
  this.foo = 'foo';
}

Foo.prototype.update = function () {
  this.foo = 'updated';
};

export const bar = 'bar';
