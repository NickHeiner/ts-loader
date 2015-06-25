///<reference path="node_modules/typescript/bin/typescript.d.ts" />
///<reference path="node_modules/typescript/bin/typescriptServices.d.ts" />
///<reference path="typings/node/node.d.ts" />
///<reference path="typings/loaderUtils/loaderUtils.d.ts" />
///<reference path="typings/objectAssign/objectAssign.d.ts" />
///<reference path="typings/colors/colors.d.ts" />
var typescript = require('typescript');
var path = require('path');
var fs = require('fs');
var os = require('os');
var loaderUtils = require('loader-utils');
var objectAssign = require('object-assign');
require('colors');
var instances = {};
function consoleError(msg) {
    setTimeout(function () { return console.log('ERROR' + os.EOL + msg); }, 0);
}
function handleErrors(diagnostics, compiler, outputFn) {
    diagnostics.forEach(function (diagnostic) {
        var messageText = compiler.flattenDiagnosticMessageText(diagnostic.messageText, os.EOL);
        if (diagnostic.file) {
            var lineChar = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
            outputFn("  " + diagnostic.file.fileName.blue + " (" + (lineChar.line + 1).toString().cyan + "," + (lineChar.character + 1).toString().cyan + "): " + messageText.red, messageText, { line: lineChar.line + 1, character: lineChar.character + 1 });
        }
        else {
            outputFn("  " + "unknown file".blue + ": " + messageText.red, messageText, null);
        }
    });
}
function findConfigFile(compiler, searchPath, configFileName) {
    while (true) {
        var fileName = path.join(searchPath, configFileName);
        if (compiler.sys.fileExists(fileName)) {
            return fileName;
        }
        var parentPath = path.dirname(searchPath);
        if (parentPath === searchPath) {
            break;
        }
        searchPath = parentPath;
    }
    return undefined;
}
function ensureTypeScriptInstance(options, loader) {
    function log() {
        var messages = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            messages[_i - 0] = arguments[_i];
        }
        if (!options.silent) {
            console.log.apply(console, messages);
        }
    }
    var compiler = require(options.compiler);
    var files = {};
    if (Object.prototype.hasOwnProperty.call(instances, options.instance)) {
        return instances[options.instance];
    }
    var compilerOptions = {
        module: 1 /* CommonJS */
    };
    var filesToLoad = [];
    var configFilePath = findConfigFile(compiler, path.dirname(loader.resourcePath), options.configFileName);
    if (configFilePath) {
        log('Using config file at '.green + configFilePath.blue);
        var configFile = compiler.readConfigFile(configFilePath);
        // TODO: when 1.5 stable comes out, this will never be undefined. Instead it will
        // have an 'error' property
        if (!configFile) {
            throw new Error('tsconfig.json file found but not parsable');
        }
        var configParseResult = compiler.parseConfigFile(configFile, path.dirname(configFilePath));
        if (configParseResult.errors.length) {
            handleErrors(languageService.getCompilerOptionsDiagnostics(), compiler, consoleError);
            throw new Error('error while parsing tsconfig.json');
        }
        objectAssign(compilerOptions, configParseResult.options);
        filesToLoad = configParseResult.fileNames;
    }
    var libFileName = 'lib.d.ts';
    if (compilerOptions.target == 2 /* ES6 */) {
        // Special handling for ES6 targets
        compilerOptions.module = 0 /* None */;
        libFileName = 'lib.es6.d.ts';
    }
    if (!compilerOptions.noLib) {
        filesToLoad.push(path.join(path.dirname(require.resolve('typescript')), libFileName));
    }
    filesToLoad.forEach(function (filePath) {
        filePath = path.normalize(filePath);
        files[filePath] = {
            text: fs.readFileSync(filePath, 'utf-8'),
            version: 0
        };
    });
    var servicesHost = {
        getScriptFileNames: function () { return Object.keys(files); },
        getScriptVersion: function (fileName) {
            fileName = path.normalize(fileName);
            return files[fileName] && files[fileName].version.toString();
        },
        getScriptSnapshot: function (fileName) {
            fileName = path.normalize(fileName);
            var file = files[fileName];
            if (!file) {
                try {
                    file = files[fileName] = {
                        version: 0,
                        text: fs.readFileSync(fileName, { encoding: 'utf8' })
                    };
                }
                catch (e) {
                    return;
                }
            }
            return compiler.ScriptSnapshot.fromString(file.text);
        },
        getCurrentDirectory: function () { return process.cwd(); },
        getCompilationSettings: function () { return compilerOptions; },
        getDefaultLibFileName: function (options) { return libFileName; },
        getNewLine: function () { return os.EOL; },
        log: log
    };
    var languageService = compiler.createLanguageService(servicesHost, compiler.createDocumentRegistry());
    var instance = instances[options.instance] = {
        compiler: compiler,
        compilerOptions: compilerOptions,
        files: files,
        languageService: languageService
    };
    handleErrors(languageService.getCompilerOptionsDiagnostics(), compiler, consoleError);
    // handle errors for all declaration files at the end of each compilation
    loader._compiler.plugin("done", function (stats) {
        Object.keys(instance.files)
            .filter(function (filePath) { return !!filePath.match(/\.d\.ts$/); })
            .forEach(function (filePath) {
            handleErrors(languageService.getSyntacticDiagnostics(filePath).concat(languageService.getSemanticDiagnostics(filePath)), compiler, function (message, rawMessage, location) {
                stats.compilation.errors.push({
                    file: filePath,
                    message: message,
                    rawMessage: rawMessage,
                    location: location
                });
            });
        });
    });
    // manually update changed declaration files
    loader._compiler.plugin("watch-run", function (watching, cb) {
        var mtimes = watching.compiler.watchFileSystem.watcher.mtimes;
        Object.keys(mtimes)
            .filter(function (filePath) { return !!filePath.match(/\.d\.ts$/); })
            .forEach(function (filePath) {
            filePath = path.normalize(filePath);
            var file = instance.files[filePath];
            if (file) {
                file.text = fs.readFileSync(filePath, { encoding: 'utf8' });
                file.version++;
            }
        });
        cb();
    });
    return instance;
}
function loader(contents) {
    var _this = this;
    this.cacheable && this.cacheable();
    var callback = this.async();
    var filePath = path.normalize(this.resourcePath);
    var options = loaderUtils.parseQuery(this.query);
    options = objectAssign({}, {
        instance: 'default',
        compiler: 'typescript',
        configFileName: 'tsconfig.json'
    }, options);
    var instance = ensureTypeScriptInstance(options, this), file = instance.files[filePath], langService = instance.languageService;
    if (!file) {
        file = instance.files[filePath] = { version: 0 };
    }
    file.text = contents;
    file.version++;
    this.clearDependencies();
    this.addDependency(filePath);
    Object.keys(instance.files).filter(function (filePath) { return !!filePath.match(/\.d\.ts$/); }).forEach(this.addDependency.bind(this));
    var output = langService.getEmitOutput(filePath);
    handleErrors(langService.getSyntacticDiagnostics(filePath).concat(langService.getSemanticDiagnostics(filePath)), instance.compiler, function (message, rawMessage, location) {
        _this._module.errors.push({
            file: filePath,
            module: _this._module,
            message: message,
            rawMessage: rawMessage,
            location: location
        });
    });
    if (output.outputFiles.length == 0)
        throw new Error("Typescript emitted no output for " + filePath);
    var sourceMap;
    if (output.outputFiles.length == 2) {
        sourceMap = JSON.parse(output.outputFiles[0].text);
        sourceMap.sources = [loaderUtils.getRemainingRequest(this)];
        sourceMap.file = loaderUtils.getCurrentRequest(this);
        sourceMap.sourcesContent = [contents];
        contents = output.outputFiles[1].text.replace(/^\/\/# sourceMappingURL=[^\r\n]*/gm, '');
    }
    else {
        contents = output.outputFiles[0].text;
    }
    this._module.meta['tsLoaderFileVersion'] = file.version;
    callback(null, contents, sourceMap);
}
module.exports = loader;
