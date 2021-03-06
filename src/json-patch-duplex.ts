/*!
 * https://github.com/Starcounter-Jack/JSON-Patch
 * json-patch-duplex.js version: 0.5.4
 * (c) 2013 Joachim Wester
 * MIT license
 */

interface Object {
  observe : any;
  deliverChangeRecords : any;
  unobserve : any;
  setPrototypeOf : any;
}

var OriginalError = Error;

module jsonpatch {
  /* Do nothing if module is already defined.
     Doesn't look nice, as we cannot simply put
     `!jsonpatch &&` before this immediate function call
     in TypeScript.
     */
  if (jsonpatch.observe) {
      return;
  }


  var _objectKeys = (function () {
    if (Object.keys)
      return Object.keys;

    return function (o) { //IE8
      var keys = [];
      for (var i in o) {
        if (o.hasOwnProperty(i)) {
          keys.push(i);
        }
      }
      return keys;
    }
  })();

  function _equals(a, b) {
    switch (typeof a) {
      case 'undefined': //backward compatibility, but really I think we should return false
      case 'boolean':
      case 'string':
      case 'number':
        return a === b;
      case 'object':
        if (a === null)
          return b === null;
        if (_isArray(a)) {
          if (!_isArray(b) || a.length !== b.length)
            return false;

          for (var i = 0, l = a.length; i < l; i++)
            if (!_equals(a[i], b[i])) return false;

          return true;
        }

        var bKeys = _objectKeys(b);
        var bLength = bKeys.length;
        if (_objectKeys(a).length !== bLength)
          return false;

        for (var i = 0; i < bLength; i++)
          if (!_equals(a[i], b[i])) return false;

        return true;

      default:
        return false;

    }
  }

  /* We use a Javascript hash to store each
   function. Each hash entry (property) uses
   the operation identifiers specified in rfc6902.
   In this way, we can map each patch operation
   to its dedicated function in efficient way.
   */

  /* The operations applicable to an object */
  var objOps = {
    add: function (obj, key) {
      obj[key] = this.value;
      return true;
    },
    remove: function (obj, key) {
      delete obj[key];
      return true;
    },
    replace: function (obj, key) {
      obj[key] = this.value;
      return true;
    },
    move: function (obj, key, tree) {
      var temp:any = {op: "_get", path: this.from};
      apply(tree, [temp]);
      apply(tree, [
        {op: "remove", path: this.from}
      ]);
      apply(tree, [
        {op: "add", path: this.path, value: temp.value}
      ]);
      return true;
    },
    copy: function (obj, key, tree) {
      var temp:any = {op: "_get", path: this.from};
      apply(tree, [temp]);
      apply(tree, [
        {op: "add", path: this.path, value: temp.value}
      ]);
      return true;
    },
    test: function (obj, key) {
      return _equals(obj[key], this.value);
    },
    _get: function (obj, key) {
      this.value = obj[key];
    }
  };

  /* The operations applicable to an array. Many are the same as for the object */
  var arrOps = {
    add: function (arr, i) {
      arr.splice(i, 0, this.value);
      return true;
    },
    remove: function (arr, i) {
      arr.splice(i, 1);
      return true;
    },
    replace: function (arr, i) {
      arr[i] = this.value;
      return true;
    },
    move: objOps.move,
    copy: objOps.copy,
    test: objOps.test,
    _get: objOps._get
  };

  /* The operations applicable to object root. Many are the same as for the object */
  var rootOps = {
    add: function (obj) {
      rootOps.remove.call(this, obj);
      for (var key in this.value) {
        if (this.value.hasOwnProperty(key)) {
          obj[key] = this.value[key];
        }
      }
      return true;
    },
    remove: function (obj) {
      for (var key in obj) {
        if (obj.hasOwnProperty(key)) {
          objOps.remove.call(this, obj, key);
        }
      }
      return true;
    },
    replace: function (obj) {
      apply(obj, [
        {op: "remove", path: this.path}
      ]);
      apply(obj, [
        {op: "add", path: this.path, value: this.value}
      ]);
      return true;
    },
    move: objOps.move,
    copy: objOps.copy,
    test: function (obj) {
      return (JSON.stringify(obj) === JSON.stringify(this.value));
    },
    _get: function (obj) {
      this.value = obj;
    }
  };

  var observeOps = {
    add: function (patches:any[], path) {
      var patch = {
        op: "add",
        path: path + escapePathComponent(this.name),
        value: this.object[this.name]};
      patches.push(patch);
    },
    'delete': function (patches:any[], path) { //single quotes needed because 'delete' is a keyword in IE8
      var patch = {
        op: "remove",
        path: path + escapePathComponent(this.name)
      };
      patches.push(patch);
    },
    update: function (patches:any[], path) {
      var patch = {
        op: "replace",
        path: path + escapePathComponent(this.name),
        value: this.object[this.name]
      };
      patches.push(patch);
    }
  };

  function escapePathComponent (str) {
    if (str.indexOf('/') === -1 && str.indexOf('~') === -1) return str;
    return str.replace(/~/g, '~0').replace(/\//g, '~1');
  }

  function _getPathRecursive(root:Object, obj:Object):string {
    var found;
    for (var key in root) {
      if (root.hasOwnProperty(key)) {
        if (root[key] === obj) {
          return escapePathComponent(key) + '/';
        }
        else if (typeof root[key] === 'object') {
          found = _getPathRecursive(root[key], obj);
          if (found != '') {
            return escapePathComponent(key) + '/' + found;
          }
        }
      }
    }
    return '';
  }

  function getPath(root:Object, obj:Object):string {
    if (root === obj) {
      return '/';
    }
    var path = _getPathRecursive(root, obj);
    if (path === '') {
      throw new OriginalError("Object not found in root");
    }
    return '/' + path;
  }

  var beforeDict = [];

  export var intervals;

  class Mirror {
    obj: any;
    observers = [];

    constructor(obj:any){
      this.obj = obj;
    }
  }

  class ObserverInfo {
    callback: any;
    observer: any;

    constructor(callback, observer){
      this.callback = callback;
      this.observer = observer;
    }
  }

  function getMirror(obj:any):any {
    for (var i = 0, ilen = beforeDict.length; i < ilen; i++) {
      if (beforeDict[i].obj === obj) {
        return beforeDict[i];
      }
    }
  }

  function getObserverFromMirror(mirror:any, callback):any {
    for (var j = 0, jlen = mirror.observers.length; j < jlen; j++) {
      if (mirror.observers[j].callback === callback) {
        return mirror.observers[j].observer;
      }
    }
  }

  function removeObserverFromMirror(mirror:any, observer):any {
    for (var j = 0, jlen = mirror.observers.length; j < jlen; j++) {
      if (mirror.observers[j].observer === observer) {
        mirror.observers.splice(j, 1);
        return;
      }
    }
  }

  export function unobserve(root, observer) {
    generate(observer);
    if(Object.observe) {
      _unobserve(observer, root);
    }
    else {
      clearTimeout(observer.next);
    }

    var mirror = getMirror(root);
    removeObserverFromMirror(mirror, observer);

  }

  function deepClone(obj:any) {
    if (typeof obj === "object") {
      return JSON.parse(JSON.stringify(obj)); //Faster than ES5 clone - http://jsperf.com/deep-cloning-of-objects/5
    }
    else {
      return obj; //no need to clone primitives
    }
  }

  export function observe(obj:any, callback):any {
    var patches = [];
    var root = obj;
    var observer;
    var mirror = getMirror(obj);

    if (!mirror) {
      mirror = new Mirror(obj);
      beforeDict.push(mirror);
    } else {
      observer = getObserverFromMirror(mirror, callback);
    }

    if(observer){
      return observer;
    }

    if (Object.observe) {
      observer = function (arr) {
        //This "refresh" is needed to begin observing new object properties
        _unobserve(observer, obj);
        _observe(observer, obj);

        var a = 0
          , alen = arr.length;
        while (a < alen) {
          if (
            !(arr[a].name === 'length' && _isArray(arr[a].object))
              && !(arr[a].name === '__Jasmine_been_here_before__')
            ) {
            observeOps[arr[a].type].call(arr[a], patches, getPath(root, arr[a].object));
          }
          a++;
        }

        if (patches) {
          if (callback) {
            callback(patches);
          }
        }
        observer.patches = patches;
        patches = [];


      };
    } else {
      observer = {};

      mirror.value = deepClone(obj);

      if (callback) {
        //callbacks.push(callback); this has no purpose
        observer.callback = callback;
        observer.next = null;
        var intervals = this.intervals || [100, 1000, 10000, 60000];
        if (intervals.push === void 0) {
          throw new OriginalError("jsonpatch.intervals must be an array");
        }
        var currentInterval = 0;

        var dirtyCheck = function () {
          generate(observer);
        };
        var fastCheck = function () {
          clearTimeout(observer.next);
          observer.next = setTimeout(function () {
            dirtyCheck();
            currentInterval = 0;
            observer.next = setTimeout(slowCheck, intervals[currentInterval++]);
          }, 0);
        };
        var slowCheck = function () {
          dirtyCheck();
          if (currentInterval == intervals.length)
            currentInterval = intervals.length - 1;
          observer.next = setTimeout(slowCheck, intervals[currentInterval++]);
        };
        if (typeof window !== 'undefined') { //not Node
          if (window.addEventListener) { //standards
            window.addEventListener('mousedown', fastCheck);
            window.addEventListener('mouseup', fastCheck);
            window.addEventListener('keydown', fastCheck);
          }
          else { //IE8
            document.documentElement.attachEvent('onmousedown', fastCheck);
            document.documentElement.attachEvent('onmouseup', fastCheck);
            document.documentElement.attachEvent('onkeydown', fastCheck);
          }
        }
        observer.next = setTimeout(slowCheck, intervals[currentInterval++]);
      }
    }
    observer.patches = patches;
    observer.object = obj;

    mirror.observers.push(new ObserverInfo(callback, observer));

    return _observe(observer, obj);
  }

  /// Listen to changes on an object tree, accumulate patches
  function _observe(observer:any, obj:any):any {
    if (Object.observe) {
      Object.observe(obj, observer);
      for (var key in obj) {
        if (obj.hasOwnProperty(key)) {
          var v:any = obj[key];
          if (v && typeof (v) === "object") {
            _observe(observer, v);
          }
        }
      }
    }
    return observer;
  }

  function _unobserve(observer:any, obj:any):any {
    if (Object.observe) {
      Object.unobserve(obj, observer);
      for (var key in obj) {
        if (obj.hasOwnProperty(key)) {
          var v:any = obj[key];
          if (v && typeof (v) === "object") {
            _unobserve(observer, v);
          }
        }
      }
    }
    return observer;
  }

  export function generate(observer) {
    if (Object.observe) {
      Object.deliverChangeRecords(observer);
    }
    else {
      var mirror;
      for (var i = 0, ilen = beforeDict.length; i < ilen; i++) {
        if (beforeDict[i].obj === observer.object) {
          mirror = beforeDict[i];
          break;
        }
      }
      _generate(mirror.value, observer.object, observer.patches, "");
      if(observer.patches.length) {
        apply(mirror.value, observer.patches);
      }
    }
    var temp = observer.patches;
    if(temp.length > 0) {
      observer.patches = [];
      if(observer.callback) {
        observer.callback(temp);
      }
    }
    return temp;
  }

  // Dirty check if obj is different from mirror, generate patches and update mirror
  function _generate(mirror, obj, patches, path) {
    var newKeys = _objectKeys(obj);
    var oldKeys = _objectKeys(mirror);
    var changed = false;
    var deleted = false;

    //if ever "move" operation is implemented here, make sure this test runs OK: "should not generate the same patch twice (move)"

    for (var t = oldKeys.length - 1; t >= 0; t--) {
      var key = oldKeys[t];
      var oldVal = mirror[key];
      if (obj.hasOwnProperty(key)) {
        var newVal = obj[key];
        if (typeof oldVal == "object" && oldVal != null && typeof newVal == "object" && newVal != null) {
          _generate(oldVal, newVal, patches, path + "/" + escapePathComponent(key));
        }
        else {
          if (oldVal != newVal) {
            changed = true;
            patches.push({op: "replace", path: path + "/" + escapePathComponent(key), value: deepClone(newVal)});
          }
        }
      }
      else {
        patches.push({op: "remove", path: path + "/" + escapePathComponent(key)});
        deleted = true; // property has been deleted
      }
    }

    if (!deleted && newKeys.length == oldKeys.length) {
      return;
    }

    for (var t = 0; t < newKeys.length; t++) {
      var key = newKeys[t];
      if (!mirror.hasOwnProperty(key)) {
        patches.push({op: "add", path: path + "/" + escapePathComponent(key), value: deepClone(obj[key])});
      }
    }
  }

  var _isArray;
  if (Array.isArray) { //standards; http://jsperf.com/isarray-shim/4
    _isArray = Array.isArray;
  }
  else { //IE8 shim
    _isArray = function (obj:any) {
      return obj.push && typeof obj.length === 'number';
    }
  }

  //3x faster than cached /^\d+$/.test(str)
  function isInteger(str:string):boolean {
    var i = 0;
    var len = str.length;
    var charCode;
    while (i < len) {
      charCode = str.charCodeAt(i);
      if (charCode >= 48 && charCode <= 57) {
        i++;
        continue;
      }
      return false;
    }
    return true;
  }

  /// Apply a json-patch operation on an object tree
  export function apply(tree:any, patches:any[], validate?:boolean):boolean {
    var result = false
        , p = 0
        , plen = patches.length
        , patch
        , key;
    while (p < plen) {
      patch = patches[p];
      p++;
      // Find the object
      var path = patch.path || "";
      var keys = path.split('/');
      var obj = tree;
      var t = 1; //skip empty element - http://jsperf.com/to-shift-or-not-to-shift
      var len = keys.length;
      var existingPathFragment = undefined;

      while (true) {
        key = keys[t];

        if (validate) {
          if (existingPathFragment === undefined) {
            if (obj[key] === undefined) {
              existingPathFragment = keys.slice(0, t).join('/');
            }
            else if (t == len - 1) {
              existingPathFragment = patch.path;
            }
            if (existingPathFragment !== undefined) {
              this.validator(patch, p - 1, tree, existingPathFragment);
            }
          }
        }

        t++;
        if(key === undefined) { //is root
          if (t >= len) {
            result = rootOps[patch.op].call(patch, obj, key, tree); // Apply patch
            break;
          }
        }
        if (_isArray(obj)) {
          if (key === '-') {
            key = obj.length;
          }
          else {
            if (validate && !isInteger(key)) {
              throw new JsonPatchError("Expected an unsigned base-10 integer value, making the new referenced value the array element with the zero-based index", "OPERATION_PATH_ILLEGAL_ARRAY_INDEX", p - 1, patch.path, patch);
            }
            key = parseInt(key, 10);
          }
          if (t >= len) {
            if (validate && patch.op === "add" && key > obj.length) {
              throw new JsonPatchError("The specified index MUST NOT be greater than the number of elements in the array", "OPERATION_VALUE_OUT_OF_BOUNDS", p - 1, patch.path, patch);
            }
            result = arrOps[patch.op].call(patch, obj, key, tree); // Apply patch
            break;
          }
        }
        else {
          if (key && key.indexOf('~') != -1)
            key = key.replace(/~1/g, '/').replace(/~0/g, '~'); // escape chars
          if (t >= len) {
            result = objOps[patch.op].call(patch, obj, key, tree); // Apply patch
            break;
          }
        }
        obj = obj[key];
      }
    }
    return result;
  }

  export function compare(tree1:any, tree2:any):any[] {
    var patches = [];
    _generate(tree1, tree2, patches, '');
    return patches;
  }

  export declare class OriginalError {
    public name:string;
    public message:string;
    public stack:string;

    constructor(message?:string);
  }

  export class JsonPatchError extends OriginalError {
    constructor(public message:string, public name:string, public index?:number, public operation?:any, public tree?:any) {
      super(message);
    }
  }

  export var Error = JsonPatchError;

    /**
     * Recursively checks whether an object has any undefined values inside.
     */
    export function hasUndefined(obj:any): boolean {
        if (obj === undefined) {
            return true;
        }

        if (typeof obj == "array" || typeof obj == "object") {
            for (var i in obj) {
                if (hasUndefined(obj[i])) {
                    return true;
                }
            }
        }

        return false;
   }

  /**
   * Validates a single operation. Called from `jsonpatch.validate`. Throws `JsonPatchError` in case of an error.
   * @param {object} operation - operation object (patch)
   * @param {number} index - index of operation in the sequence
   * @param {object} [tree] - object where the operation is supposed to be applied
   * @param {string} [existingPathFragment] - comes along with `tree`
   */
  export function validator(operation:any, index:number, tree?:any, existingPathFragment?:string) {
    if (typeof operation !== 'object' || operation === null || _isArray(operation)) {
      throw new JsonPatchError('Operation is not an object', 'OPERATION_NOT_AN_OBJECT', index, operation, tree);
    }

    else if (!objOps[operation.op]) {
      throw new JsonPatchError('Operation `op` property is not one of operations defined in RFC-6902', 'OPERATION_OP_INVALID', index, operation, tree);
    }

    else if (typeof operation.path !== 'string') {
      throw new JsonPatchError('Operation `path` property is not a string', 'OPERATION_PATH_INVALID', index, operation, tree);
    }

    else if ((operation.op === 'move' || operation.op === 'copy') && typeof operation.from !== 'string') {
      throw new JsonPatchError('Operation `from` property is not present (applicable in `move` and `copy` operations)', 'OPERATION_FROM_REQUIRED', index, operation, tree);
    }

    else if ((operation.op === 'add' || operation.op === 'replace' || operation.op === 'test') && operation.value === undefined) {
      throw new JsonPatchError('Operation `value` property is not present (applicable in `add`, `replace` and `test` operations)', 'OPERATION_VALUE_REQUIRED', index, operation, tree);
    }

    else if ((operation.op === 'add' || operation.op === 'replace' || operation.op === 'test') && hasUndefined(operation.value)) {
      throw new JsonPatchError('Operation `value` property is not present (applicable in `add`, `replace` and `test` operations)', 'OPERATION_VALUE_CANNOT_CONTAIN_UNDEFINED', index, operation, tree);
    }

    else if (tree) {
      if (operation.op == "add") {
        var pathLen = operation.path.split("/").length;
        var existingPathLen = existingPathFragment.split("/").length;
        if (pathLen !== existingPathLen + 1 && pathLen !== existingPathLen) {
          throw new JsonPatchError('Cannot perform an `add` operation at the desired path', 'OPERATION_PATH_CANNOT_ADD', index, operation, tree);
        }
      }
      else if(operation.op === 'replace' || operation.op === 'remove' || operation.op === '_get') {
        if (operation.path !== existingPathFragment) {
          throw new JsonPatchError('Cannot perform the operation at a path that does not exist', 'OPERATION_PATH_UNRESOLVABLE', index, operation, tree);
        }
      }
      else if (operation.op === 'move' || operation.op === 'copy') {
        var existingValue = {op: "_get", path: operation.from, value: undefined};
        var error = jsonpatch.validate([existingValue], tree);
        if (error && error.name === 'OPERATION_PATH_UNRESOLVABLE') {
          throw new JsonPatchError('Cannot perform the operation from a path that does not exist', 'OPERATION_FROM_UNRESOLVABLE', index, operation, tree);
        }
      }
    }
  }

  /**
   * Validates a sequence of operations. If `tree` parameter is provided, the sequence is additionally validated against the object tree.
   * If error is encountered, returns a JsonPatchError object
   * @param sequence
   * @param tree
   * @returns {JsonPatchError|undefined}
   */
  export function validate(sequence:any[], tree?:any):JsonPatchError {
    try {
      if (!_isArray(sequence)) {
        throw new JsonPatchError('Patch sequence must be an array', 'SEQUENCE_NOT_AN_ARRAY');
      }

      if (tree) {
        tree = JSON.parse(JSON.stringify(tree)); //clone tree so that we can safely try applying operations
        apply.call(this, tree, sequence, true);
      }
      else {
        for (var i = 0; i < sequence.length; i++) {
          this.validator(sequence[i], i);
        }
      }
    }
    catch (e) {
      if (e instanceof JsonPatchError) {
        return e;
      }
      else {
        throw e;
      }
    }
  }
}

declare var exports:any;

if (typeof exports !== "undefined") {
  exports.apply = jsonpatch.apply;
  exports.observe = jsonpatch.observe;
  exports.unobserve = jsonpatch.unobserve;
  exports.generate = jsonpatch.generate;
  exports.compare = jsonpatch.compare;
  exports.validate = jsonpatch.validate;
  exports.validator = jsonpatch.validator;
  exports.JsonPatchError = jsonpatch.JsonPatchError;
  exports.Error = jsonpatch.Error;
}
