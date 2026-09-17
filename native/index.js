try {
  module.exports = require('./build/Release/keyboard_hook.node');
} catch (e) {
  try {
    module.exports = require('./build/Debug/keyboard_hook.node');
  } catch (e2) {
    throw new Error('Native keyboard hook module not found. Please run: npm install in the native directory');
  }
}
