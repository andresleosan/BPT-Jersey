import "@testing-library/jest-dom/vitest";

// jsdom does not implement the native dialog lifecycle. Browser checks cover the focus trap.
HTMLDialogElement.prototype.showModal = function () {
  this.open = true;
};
HTMLDialogElement.prototype.close = function () {
  this.open = false;
};
