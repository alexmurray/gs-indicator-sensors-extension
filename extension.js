/* -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*- */
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

	this.label = new St.Label();

        this.prop = new Properties(path);
        this.prop.connectSignal('PropertiesChanged', Lang.bind(this, function(proxy, sender, [iface, props]) {
            this.update();
        }));
        this.update();
	this.addActor(this.label);
    },

    update: function() {
        // TODO: take digits into account and format string better
        this.label.text = (this.sensor.Label + ' ' + this.sensor.Value.toFixed(this.sensor.Digits) + this.sensor.Units);
    },
});

const IndicatorSensorsIndicator = new Lang.Class({
    Name: 'IndicatorSensors.Indicator',
    Extends: PanelMenu.SystemStatusButton,

    _init: function() {
        // TODO: add translation
	this.parent('indicator-sensors', "Hardware Sensors Indicator");

        // replace our icon with a label to show the primary sensor
        this.actor.remove_actor(this.actor.get_children()[0]);
        this._label = new St.Label();
        this._primaryItem = null;
        this.actor.add_actor(this._label);

	this._itemsSection = new PopupMenu.PopupMenuSection();
	this.menu.addMenuItem(this._itemsSection);
        this._items = {};

        this._indicatorSensors = new IndicatorSensors();
        this._indicatorSensors.HideIndicatorRemote();

        // add preferences menu item
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        let prefsItem = new PopupMenu.PopupMenuItem('Preferences');
        prefsItem.connect('activate', Lang.bind(this, function(event) {
            this._indicatorSensors.ShowPreferencesRemote();
        }));
	this.menu.addMenuItem(prefsItem);
        this._objectManager = new ObjectManager();
        this._objectManager.GetManagedObjectsRemote(Lang.bind(this, function(result, error) {
            // result contains the exported objects (sensors in this
            // case) indexed by path
            let objects = result[0];
            for each (path in Object.keys(objects)) {
                // TODO: by convention this only exports
                // ActiveSensor's but we should probably loop through
                // the exported interfaces for each object to check...
                let sensor = new ActiveSensor(path);
                this.addSensor(sensor, path);
            }
        }));
        this._objectManager.connectSignal('InterfacesAdded', Lang.bind(this, function(proxy, sender, [path, props]) {
            global.log("interface added:" + path);
            let sensor = new ActiveSensor(path);
            this.addSensor(sensor, path);
        }));
        this._objectManager.connectSignal('InterfacesRemoved', Lang.bind(this, function(proxy, sender, [path, props]) {
            global.log("interface removed:" + path);
            this.removeSensor(path);
        }));
    },

    updateLabel: function () {
        let text = 'No sensors';
        if (this._primaryItem) {
            text = this._primaryItem.label.text;
        }
        this._label.text = text;
    },

    setPrimaryItem: function (item) {
        if (this._primaryItem) {
            this._primaryItem.prop.disconnectSignal(this._id);
            this._primaryItem.setShowDot(false);
            this._primaryItem = null;
            this._id = null;
        }
        this._primaryItem = item;
        if (this._primaryItem) {
            this._primaryItem.setShowDot(true);
            this._id = this._primaryItem.prop.connectSignal('PropertiesChanged', Lang.bind(this, function(proxy, sender, [iface, props]) {
                this.updateLabel();
            }));
        }
        this.updateLabel();
    },

    addSensor: function (sensor, path) {
        let item = new IndicatorSensorsItem(sensor, path);
        item.connect('activate', Lang.bind(this, function(event) {
            // set this item as primary one
            this.setPrimaryItem(item);
        }));
        this._items[path] = { sensor: sensor, item: item };
        this._itemsSection.addMenuItem(item, sensor.Index);
        if (!this._primaryItem) {
            this.setPrimaryItem(item);
        }
    },

    removeSensor: function (path) {
        global.log("Removing sensor: " + path);
        let sensor = this._items[path].sensor;
        let item = this._items[path].item;
        delete this._items[path];
        if (item == this._primaryItem) {
            let paths = Object.keys(this._items);
            if (paths.length > 0) {
                this.setPrimaryItem((this._items[paths[0]]).item);
            } else {
                this.setPrimaryItem(null);
            }
        }

        // no need to explicitly remove item, just destroy it
        item.destroy();
        delete sensor;
    },

    destroy: function() {
        global.log("Removing all sensors");
        for each (path in Object.keys(this._items)) {
            this.removeSensor(path);
        }
	this.parent();
    },
});

function init() {
    // nothing to do here
}

let _indicator;

function enable() {
    _indicator = new IndicatorSensorsIndicator;
    Main.panel.addToStatusArea('indicator-sensors', _indicator);
}

function disable() {
    // disconnect from dbus
    _indicator.destroy();
}
