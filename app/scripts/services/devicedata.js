"use strict";

angular.module("homeuiApp")
  .factory("DeviceData", mqttClient => {
    var devices = {}, cells = {};

    var cellTypeMap = {
      "text": {
        valueType: "string",
        units: ""
      },
      "switch": {
        valueType: "boolean",
        units: ""
      },
      "wo-switch": {
        valueType: "boolean",
        units: ""
      },
      "alarm": {
        valueType: "boolean",
        units: ""
      },
      "pushbutton": {
        valueType: "pushbutton",
        units: ""
      },
      "temperature": {
        valueType: "number",
        units: "°C"
      },
      "rel_humidity": {
        valueType: "number",
        units: "%, RH"
      },
      "atmospheric_pressure": {
        valueType: "number",
        units: "millibar (100 Pa)"
      },
      "rainfall": {
        valueType: "number",
        units: "mm/h"
      },
      "wind_speed": {
        valueType: "number",
        units: "m/s"
      },
      "power": {
        valueType: "number",
        units: "W"
      },
      "power_consumption": {
        valueType: "number",
        units: "kWh"
      },
      "voltage": {
        valueType: "number",
        units: "V"
      },
      "water_flow": {
        valueType: "number",
        units: "m³/h"
      },
      "water_consumption": {
        valueType: "number",
        units: "m³"
      },
      "resistance": {
        valueType: "number",
        units: "Ohm"
      },
      "concentration": {
        valueType: "number",
        units: "ppm"
      },
      "pressure": {
        valueType: "number",
        units: "bar"
      },
      "range": {
        valueType: "number",
        units: ""
      },
      "value": {
        valueType: "number",
        units: ""
      },
      "rgb": {
        valueType: "rgb",
        units: ""
      }
    };

    function splitTopic (topic) {
      return topic.substring(1).split("/");
    }

    function ensureDevice (name) {
      if (!devices.hasOwnProperty(name))
        devices[name] = { name: name, explicit: false, cellNames: [] };
      return devices[name];
    }

    function maybeRemoveDevice (name) {
      if (!devices.hasOwnProperty(name))
        return;
      if (!devices[name].explicit && !devices[name].cellNames.length)
        delete devices[name];
    }

    function parseCellTopic (topic) {
      var parts = splitTopic(topic);
      ensureDevice(parts[1]);
      return parts[1] + "/" + parts[3];
    }

    function internCell (name) {
      if (cells.hasOwnProperty(name))
        return cells[name];
      var cell = new Cell(name);
      cells[name] = cell;
      return cell;
    }

    function cellFromTopic (topic) {
      return internCell(parseCellTopic(topic));
    }

    function colorChannel(value) {
      value -= 0;
      return !(value >= 0 && value <= 255) ? 0 : value;
    }

    function parseRgb (value) {
      var m = ("" + value).match(/(\d+);(\d+);(\d+)/);
      if (!m)
        return{ r: 0, g: 0, b: 0 };
      return {
        r: colorChannel(m[1]),
        g: colorChannel(m[2]),
        b: colorChannel(m[3])
      };
    }

    function formatRgb (value) {
      return [value.r, value.g, value.b].join(";");
    }

    function isRgb (value) {
      return angular.isObject(value) && ["r", "g", "b"].every(c => value.hasOwnProperty(c));
    }

    class Cell {
      constructor (id) {
        this.id = id;
        var parts = this.id.split("/");
        if (parts.length != 2)
          throw new Error("invalid cell id: " + this.id);
        this.deviceName = parts[0];
        this.controlName = parts[1];
        this.name = this.controlName;
        this.type = "incomplete";
        this.units = "";
        this._value = null;
        this.readOnly = false;
        this.error = false;
        this.min = null;
        this.max = null;
        this.step = null;
      }

      get value () {
        return this._value;
      }

      set value (newValue) {
        this.sendValue(newValue);
      }

      valueType () {
        return cellTypeMap.hasOwnProperty(this.type) ? cellTypeMap[this.type].valueType : "string";
      }

      _addToDevice () {
        var devCellNames = ensureDevice(this.deviceName).cellNames;
        if (devCellNames.indexOf(this.id) < 0) {
          devCellNames.push(this.id);
          devCellNames.sort();
        }
      }

      _removeFromDevice () {
        if (!devices.hasOwnProperty(this.deviceName))
          return;
        devices[this.deviceName].cellNames = devices[this.deviceName].cellNames.filter(name => name != this.id);
      }

      _setCellValue (value) {
        switch (this.valueType()) {
        case "number":
          this._value = value - 0;
          break;
        case "boolean":
          this._value = typeof value == "bool" ? value : value == "1";
          break;
        case "pushbutton":
          // unsettable
          break;
        case "rgb":
          this._value = isRgb(value) ? value : parseRgb(value);
          break;
        case "string":
        default:
          this._value = "" + value;
          break;
        }
      }

      stringValue () {
        switch (this.valueType()) {
        case "boolean":
          return this._value ? "1" : "0";
        case "pushbutton":
          return null;
        case "rgb":
          return isRgb(this._value) ? formatRgb(this._value) : "";
        case "number":
        case "string":
        default:
          return "" + this._value;
        }
      }

      _sendValueTopic () {
        return ["", "devices", this.deviceName, "controls", this.controlName, "on"].join("/");
      }

      _isButton () {
        return this.type == "pushbutton";
      }

      _isText () {
        return this.type == "text";
      }

      receiveValue (newValue) {
        if (!newValue)
          this._value = this._isText() ? "" : null; // value removed, non-pushbutton/text cell becomes incomplete
        else
          this._setCellValue(newValue);
        this._updateCompleteness();
      }

      sendValue (newValue) {
        if (!this.isComplete() || this.readOnly)
          return;
        if (newValue === "" && !this._isText())
          newValue = this._value;
        this._setCellValue(newValue);
        mqttClient.send(
          this._sendValueTopic(),
          this._isButton() ? "1" : this.stringValue(), false);
      }

      isComplete () {
        return this.type != "incomplete" && (this._isButton() || this._value !== null);
      }

      _updateCompleteness () {
        if (this.isComplete()) {
          this._addToDevice();
          return;
        }
        this._removeFromDevice();
        maybeRemoveDevice(this.deviceName);
        if (this.type == "incomplete" && this._value === null)
          delete cells[this.id];
      }

      updateUnits () {
        if (!this.units && cellTypeMap.hasOwnProperty(this.type))
          this.units = cellTypeMap[this.type].units;
      }

      setType (type) {
        this.type = type || "incomplete";
        this.updateUnits();
        if (this._value !== null)
          this._setCellValue(this._value);
        else if (this._isText())
          this._setCellValue("");
        this._updateCompleteness();
      }

      setName (name) {
        this.name = name;
      }

      setUnits (units) {
        this.units = units;
        this.updateUnits();
      }

      setReadOnly (readOnly) {
        this.readOnly = !!readOnly;
      }

      setError (error) {
        this.error = !!error;
      }

      setMin (min) {
        this.min = min == "" ? null: min - 0;
      }

      setMax (max) {
        this.max = max == "" ? null : max - 0;
      }

      setStep (step) {
        this.step = step == "" ? null: step - 0;
      }
    }

    mqttClient.addStickySubscription("/devices/+/meta/name", msg => {
      var deviceName = splitTopic(msg.topic)[1];
      if (msg.payload == "") {
        if (!devices.hasOwnProperty(deviceName))
          return;
        devices[deviceName].name = deviceName;
        devices[deviceName].explicit = false;
        maybeRemoveDevice(deviceName);
        return;
      }
      var dev = ensureDevice(deviceName);
      dev.name = msg.payload;
      dev.explicit = true;
    });

    function addCellSubscription(suffix, handler) {
      mqttClient.addStickySubscription("/devices/+/controls/+" + suffix, msg => {
        handler(cellFromTopic(msg.topic), msg.payload);
      });
    }

    addCellSubscription("",               (cell, payload) => { cell.receiveValue(payload);       });
    addCellSubscription("/meta/type",     (cell, payload) => { cell.setType(payload);            });
    addCellSubscription("/meta/name",     (cell, payload) => { cell.setName(payload);            });
    addCellSubscription("/meta/units",    (cell, payload) => { cell.setUnits(payload);           });
    addCellSubscription("/meta/readonly", (cell, payload) => { cell.setReadOnly(payload == "1"); });
    addCellSubscription("/meta/error",    (cell, payload) => { cell.setError(!!payload);         });
    addCellSubscription("/meta/min",      (cell, payload) => { cell.setMin(payload);             });
    addCellSubscription("/meta/max",      (cell, payload) => { cell.setMax(payload);             });
    addCellSubscription("/meta/step",     (cell, payload) => { cell.setStep(payload);            });

    function filterCellNames (func) {
      return Object.keys(cells).filter(name => {
        var cell = cells[name];
        return cell.isComplete() && (!func || func(cell));
      }).sort();
    }

    var fakeCell = new Cell("nosuchdev/nosuchcell");

    class CellProxy {
      constructor (id) {
        this.id = id;
      }

      gotCell () {
        return cells.hasOwnProperty(this.id);
      }

      get cell () {
        return this.gotCell () ? cells[this.id] : fakeCell;
      }

      isComplete () {
        return this.gotCell() && this.cell.isComplete();
      }

      sendValue (newValue) {
        if (this.gotCell())
          this.cell.sendValue(newValue);
      }

      get value () { return this.cell.value; }
      set value (newValue) {
        // undefined comes from control values that didn't pass validation
        if (newValue !== undefined)
          this.cell.value = newValue;
      }

      get type () { return this.cell.type; }
      get name () { return this.cell.name; }
      get units () { return this.cell.units; }
      get readOnly () { return this.cell.readOnly; }
      get error () { return this.cell.error; }
      get min () { return this.cell.min; }
      get max () { return this.cell.max; }
      get step () { return this.cell.step; }
    }

    return {
      devices: devices,
      cells: cells,

      getCellNames () {
        return filterCellNames();
      },

      getCellNamesByType (type) {
        return filterCellNames(cell => cell.type == type).sort();
      },

      cell (name) {
        if (!cells.hasOwnProperty(name))
          throw new Error("cell not found: " + name);
        return cells[name];
      },

      proxy (name) {
        return new CellProxy(name);
      }
    };
  });