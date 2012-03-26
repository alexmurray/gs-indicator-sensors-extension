/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */
/**
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

const St = imports.gi.St;
const Main = imports.ui.main;
const Panel = imports.ui.panel;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const DBus = imports.dbus;
const Gio = imports.gi.Gio;
const Lang = imports.lang;

const BUS_NAME = 'com.github.alexmurray.IndicatorSensors';
const OBJECT_MANAGER_PATH = '/com/github/alexmurray/IndicatorSensors/ActiveSensors';

const PropertiesIface = <interface name="org.freedesktop.DBus.Properties">
<signal name="PropertiesChanged">
    <arg type="s" direction="out" />
    <arg type="a{sv}" direction="out" />
    <arg type="as" direction="out" />
</signal>
</interface>;

const PropertiesProxy = Gio.DBusProxy.makeProxyWrapper(PropertiesIface);

function Properties(path) {
    return new PropertiesProxy(Gio.DBus.session, BUS_NAME, path);
}

const ObjectManagerInterface = <interface name="org.freedesktop.DBus.ObjectManager">
<method name="GetManagedObjects">
    <arg type="a{oa{sa{sv}}}" direction="out" />
</method>
<signal name="InterfacesAdded">
    <arg type="o" direction="out" />
    <arg type="a{sa{sv}}" direction="out" />
</signal>
<signal name="InterfacesRemoved">
    <arg type="o" direction="out" />
    <arg type="as" direction="out" />
</signal>
</interface>;

const ObjectManagerProxy = Gio.DBusProxy.makeProxyWrapper(ObjectManagerInterface);

function ObjectManager() {
    return new ObjectManagerProxy(Gio.DBus.session, BUS_NAME,
                                  OBJECT_MANAGER_PATH);
}

const ActiveSensorInterface = <interface name="com.github.alexmurray.IndicatorSensors.ActiveSensor">
    <property name="Path" type="s" access="read" />
    <property name="Digits" type="u" access="read" />
    <property name="Label" type="s" access="read" />
    <property name="Units" type="s" access="read" />
    <property name="Value" type="d" access="read" />
    <property name="Index" type="u" access="read" />
</interface>;

const ActiveSensorProxy = Gio.DBusProxy.makeProxyWrapper(ActiveSensorInterface);

function ActiveSensor(path) {
    return new ActiveSensorProxy(Gio.DBus.session, BUS_NAME, path);
}


const INDICATOR_SENSORS_PATH = '/com/github/alexmurray/IndicatorSensors';

const IndicatorSensorsInterface = <interface name="com.github.alexmurray.IndicatorSensors">
<method name="ShowPreferences">
</method>
<method name="ShowIndicator">
</method>
<method name="HideIndicator">
</method>
</interface>;

const IndicatorSensorsProxy = Gio.DBusProxy.makeProxyWrapper(IndicatorSensorsInterface);

function IndicatorSensors(path) {
    return new IndicatorSensorsProxy(Gio.DBus.session,
                                     BUS_NAME,
                                     INDICATOR_SENSORS_PATH);
}

const IndicatorSensorsItem = new Lang.Class({
    Name: 'IndicatorSensors.IndicatorSensorsItem',
    Extends: PopupMenu.PopupBaseMenuItem,

    _init: function(sensor, path) {
	this.parent();
        this.sensor = sensor;

        this._label = new St.Label();
        this._valueLabel = new St.Label();
        this.addActor(this._label);
        this.addActor(this._valueLabel, { align: St.Align.END });

        this.prop = new Properties(path);
        this.prop.connectSignal('PropertiesChanged', Lang.bind(this, function(proxy, sender, [iface, props]) {
            this._update();
        }));
        this._update();
    },

    _update: function() {
        this._label.text = this.sensor.Label;
        this._valueLabel.text = (this.sensor.Value.toFixed(this.sensor.Digits) +
                                 this.sensor.Units);
    }
});

const INDICATOR_SETTINGS_SCHEMA = 'indicator-sensors.indicator';
const INDICATOR_PRIMARY_SENSOR_KEY = 'primary-sensor';
const INDICATOR_DISPLAY_FLAGS_KEY = 'display-flags';
const DisplayFlags ={
    VALUE: (1 << 0),
    LABEL: (1 << 1),
    ICON: (1 << 2)
};

const IndicatorSensorsIndicator = new Lang.Class({
    Name: 'IndicatorSensors.Indicator',
    Extends: PanelMenu.SystemStatusButton,

    _init: function() {
        this._indicatorSensors = new IndicatorSensors();
        this._indicatorSensors.HideIndicatorRemote();

        // TODO: add translation
	this.parent('indicator-sensors', "Hardware Sensors Indicator");

        this._settings = new Gio.Settings({schema: INDICATOR_SETTINGS_SCHEMA});
        this._primarySensorPath = this._settings.get_string(INDICATOR_PRIMARY_SENSOR_KEY);
        this._displayFlags = this._settings.get_int(INDICATOR_DISPLAY_FLAGS_KEY);
        this._settings.connect('changed::' + INDICATOR_DISPLAY_FLAGS_KEY,
                               Lang.bind(this, function () {
                                   this._displayFlags = this._settings.get_int(INDICATOR_DISPLAY_FLAGS_KEY);
                                   this.updateLabel();
                               }));
        this._settings.connect('changed::' + INDICATOR_PRIMARY_SENSOR_KEY,
                               Lang.bind(this, function (){
                                   global.log("primary-sensor changed to " +
                                              this._settings.get_string(INDICATOR_PRIMARY_SENSOR_KEY));
                                   this._primarySensorPath = this._settings.get_string(INDICATOR_PRIMARY_SENSOR_KEY);
                                   // try and find the primary sensor
                                   // and use it if it exists
                                   for (let path in this._items) {
                                       let { sensor: sensor,
                                             item: item } = this._items[path];
                                       if (sensor.Path == this._primarySensorPath) {
                                           global.log("found existing sensor matching primary item " + sensor.Path);
                                           this._setPrimaryItem(item);
                                       }
                                   }
                                   this.updateLabel();
                               }));
        // replace our icon with a label to show the primary sensor
        this.actor.remove_actor(this.actor.get_children()[0]);
        this._label = new St.Label();
        this._primaryItem = null;
        this.actor.add_actor(this._label);

        // create a separate section of items to add sensor items to
        // so we can keep a separator and preferences items at bottom
        // of list
	this._itemsSection = new PopupMenu.PopupMenuSection();
	this.menu.addMenuItem(this._itemsSection);

        // initialise our list of items to being empty
        this._items = {};

        // add a separator and the preferences menu item
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.addAction('Preferences', Lang.bind(this, function(event) {
            this._indicatorSensors.ShowPreferencesRemote();
        }));

        // finally connect and show any existing enabled sensors
        this._objectManager = new ObjectManager();
        this._objectManager.GetManagedObjectsRemote(Lang.bind(this, function(result, error) {
            // result contains the exported objects (sensors in this
            // case) indexed by path
            let objects = result[0];
            for each (let path in Object.keys(objects)) {
                // TODO: by convention this only exports
                // ActiveSensor's but we should probably loop through
                // the exported interfaces for each object to check...
                let sensor = new ActiveSensor(path);
                this._addSensor(sensor, path);
            }
        }));
        // make sure we dynamically update when sensors enabled /
        // disabled
        this._objectManager.connectSignal('InterfacesAdded', Lang.bind(this, function(proxy, sender, [path, props]) {
            global.log("interface added:" + path);
            let sensor = new ActiveSensor(path);
            this._addSensor(sensor, path);
        }));
        this._objectManager.connectSignal('InterfacesRemoved', Lang.bind(this, function(proxy, sender, [path, props]) {
            global.log("interface removed:" + path);
            this._removeSensor(path, true);
        }));

        // finally update our label
        this._updateLabel();
    },

    _updateLabel: function () {
        let text = 'No sensors';
        if (this._primaryItem) {
            // respect setting in gsettings
            text = '';
            if (this._displayFlags & DisplayFlags.LABEL) {
                text += this._primaryItem.sensor.Label;
            }
            if (this._displayFlags & DisplayFlags.VALUE) {
                // make sure there is a space if we have a label
                if (text != '') {
                    text += ' ';
                }
                text += this._primaryItem.sensor.Value.toFixed(this._primaryItem.sensor.Digits) + this._primaryItem.sensor.Units;
            }
        }
        this._label.text = text;
    },

    _setPrimaryItem: function (item) {
        if (item != this._primaryItem){
            if (this._primaryItem) {
                this._primaryItem.prop.disconnectSignal(this._id);
                this._primaryItem.setShowDot(false);
                this._primaryItem = null;
                this._id = null;
            }
            this._primaryItem = item;
            if (this._primaryItem) {
		let sensor = this._primaryItem.sensor;
		if (this._primarySensorPath != sensor.Path) {
                    global.log("_setPrimaryItem: setting " + INDICATOR_PRIMARY_SENSOR_KEY + ": " +
                               this._primaryItem.sensor.Path);
                    this._settings.set_string(INDICATOR_PRIMARY_SENSOR_KEY,
                                              this._primaryItem.sensor.Path);
		}
                this._primaryItem.setShowDot(true);
                this._id = this._primaryItem.prop.connectSignal('PropertiesChanged', Lang.bind(this, function(proxy, sender, [iface, props]) {
                    this._updateLabel();
                }));
            }
            this._updateLabel();
        }
    },

    _addSensor: function (sensor, path) {
        this._items[path] = { sensor: sensor };
        // since we can't easily enforce the ordering of items, remove
        // all and recreate them in the correct order
        this._itemsSection.removeAll();

        // sort all sensor paths by index
        let paths = Object.keys(this._items);
        paths = paths.sort(Lang.bind(this, function (a, b) {
            return (this._items[a].sensor.Index - this._items[b].sensor.Index);
        }));
        for (let i = 0; i < paths.length; i++) {
            let _path = paths[i];
            let _sensor = this._items[_path].sensor;
            let item = new IndicatorSensorsItem(_sensor, _path);
            this._items[_path].item = item;
            item.connect('activate', Lang.bind(this, function(item) {
                // set this item as primary one
                global.log("sensor " + item.sensor.Path + "activated - setting as primary item");
                this._setPrimaryItem(item);
            }));
            this._itemsSection.addMenuItem(item);
            // see if this path matches _primarySensorPath to update as
            // new item
            if (this._primarySensorPath == _sensor.Path) {
                this._setPrimaryItem(item);
            }
        }
    },

    _removeSensor: function (path, active) {
        global.log("Removing sensor: " + path + " [active: " + active + "]");
        let sensor = this._items[path].sensor;
        let item = this._items[path].item;
        delete this._items[path];
        if (active && item == this._primaryItem) {
            let paths = Object.keys(this._items);
            if (paths.length > 0) {
                this._setPrimaryItem((this._items[paths[0]]).item);
            } else {
                this._setPrimaryItem(null);
            }
        }

        // no need to explicitly remove item, just destroy it
        item.destroy();
        delete sensor;
    },

    destroy: function() {
        global.log("Removing all sensors");
        for each (let path in Object.keys(this._items)) {
            this._removeSensor(path, false);
        }
        this._indicatorSensors.ShowIndicatorRemote();
        delete this._items;
        delete this._settings;
	this.parent();
    }
});

function init() {
    // nothing to do here
}

let _indicator = null;
let _watch;

function enable() {
    _watch = Gio.DBus.session.watch_name(BUS_NAME,
                                         Gio.BusNameWatcherFlags.NONE,
                                         function () {
                                             _indicator = new IndicatorSensorsIndicator();
                                             Main.panel.addToStatusArea('indicator-sensors', _indicator);
                                         },
                                         function () {
                                             _indicator.destroy();
                                             _indicator = null;
                                         });
}

function disable() {
    Gio.DBus.session.unwatch_name(_watch);
    if (_indicator) {
        _indicator.destroy();
    }
}
