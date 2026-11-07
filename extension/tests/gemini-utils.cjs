const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

let source = fs.readFileSync('extension/gemini-utils.js', 'utf8')
    .replace(/export function /g, 'function ');
source += '\nmodule.exports = { targetsFor, buildTranslationPrompt, parseGeminiTranslation };';
const sandbox = {module: {exports: {}}, Map, JSON, Error};
vm.runInNewContext(source, sandbox, {filename: 'gemini-utils.js'});
const {targetsFor, buildTranslationPrompt, parseGeminiTranslation} = sandbox.module.exports;

assert.deepEqual([...targetsFor('UZ')], ['RU', 'EN']);
assert.deepEqual([...targetsFor('EN')], ['UZ', 'RU']);
assert.deepEqual([...targetsFor('RU')], ['UZ', 'EN']);
assert.match(buildTranslationPrompt('salom', 'auto'), /Detect the source language/);
assert.match(buildTranslationPrompt('hello', 'en'), /source language as EN/);

const parsed = parseGeminiTranslation(JSON.stringify({
    src: 'en',
    items: [{tag: 'RU', text: 'привет'}, {tag: 'UZ', text: 'salom'}],
}));
assert.deepEqual(JSON.parse(JSON.stringify(parsed)), {
    src: 'EN',
    items: [{tag: 'UZ', text: 'salom', error: null}, {tag: 'RU', text: 'привет', error: null}],
});
assert.throws(() => parseGeminiTranslation('{bad json}'));
assert.throws(() => parseGeminiTranslation(JSON.stringify({src: 'UZ', items: [{tag: 'RU', text: 'x'}]})));
assert.equal(parseGeminiTranslation(JSON.stringify({src: 'RU', items: [{tag: 'UZ', text: 'salom'}, {tag: 'EN', text: 'hello'}]}), 'ru').src, 'RU');

console.log('Gemini response helper tests passed.');
