import path from 'path';
import replace from '@rollup/plugin-replace';
import json from '@rollup/plugin-json'; // use to load json file

const masterVersion = require('./package.json').version; // version of nuke
const packagesDir = path.resolve(__dirname, 'packages');
const packageDir = path.resolve(packagesDir, process.env.TARGET);
const name = path.basename(packageDir);
const resolve = p => path.resolve(packageDir, p);
const pkg = require(resolve(`package.json`));
const packageOptions = pkg.buildOptions || {};

// ensure TS checks only once for each build
let hasTSChecked = false;

const outputConfigs = {
    'esm-bundler': {
        file: resolve(`dist/${name}.esm-bundler.js`),
        format: `es`
    },
    cjs: {
        file: resolve(`dist/${name}.cjs.js`),
        format: `cjs`
    },
    global: {
        file: resolve(`dist/${name}.global.js`),
        format: `iife`
    },
    esm: {
        file: resolve(`dist/${name}.esm.js`),
        format: `es`
    },
    // main "vue" package only
    'esm-bundler-runtime': {
        file: resolve(`dist/${name}.runtime.esm-bundler.js`),
        format: `es`
    },
    'global-runtime': {
        file: resolve(`dist/${name}.runtime.global.js`),
        format: 'iife'
    }
};