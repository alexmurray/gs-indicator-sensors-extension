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

const BUS_NAME = 'com.github.alexmurray.IndicatorSensors.ObjectManager';
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
    return new PropertiesProxy(Gio.DBus.session, BUS_NAME,
                               path);
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
    return new ObjectManagerProxy(Gio.DBus.session, BUS_NAME, OBJECT_MANAGER_PATH);
}

const ActiveSensorInterface = <interface name="com.github.alexmurray.IndicatorSensors.ObjectManager.ActiveSensor">
    <property name="Digits" type="u" access="read" />
    <property name="Label" type="s" access="read" />
    <property name="Units" type="s" access="read" />
    <property name="Value" type="d" access="read" />
</interface>;

const ActiveSensorProxy = Gio.DBusProxy.makeProxyWrapper(ActiveSensorInterface);

function ActiveSensor(path) {
    return new ActiveSensorProxy(Gio.DBus.session, BUS_NAME, path);
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
        // TODO: connect to PropertiesChanged signal on
        // org.freedesktop.DBus.Properties interface for the sensor to
        // update when properties change
        this.update();
	this.addActor(this.label);
    },

    update: function() {
        // TODO: take digits into account and format string better
        this.label.text = (this.sensor.Label + ' ' + this.sensor.Value + this.sensor.Units);
    },
});

const IndicatorSensors = new Lang.Class({
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

	this._contentSection = new PopupMenu.PopupMenuSection();
	this.menu.addMenuItem(this._contentSection);
        this.items = {};

        this._objectManager = new ObjectManager();
        this._objectManager.GetManagedObjectsRemote(Lang.bind(this, function(result, error) {
            // result contains the exported objects (sensors in this
            // case) indexed by path
            let objects = result[0];
            for each (path in Object.keys(objects)) {
                let sensor = new ActiveSensor(path);
                this.addSensor(sensor, path);
            }
        }));
        // TODO: connect to InterfacesAdded and InterfacesRemoved
        // signals on ObjectManager to dynamically add / remove
        // sensors
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
        this.items[path] = { sensor: sensor, item: item };
        this._contentSection.addMenuItem(item);
        if (!this._primaryItem) {
            this.setPrimaryItem(item);
        }
    },

    removeSensor: function (path) {
        global.log("Removing sensor: " + path);
        let sensor = this.items[path].sensor;
        let item = this.items[path].item;
        delete this.items[path];
        if (item == this._primaryItem) {
            let paths = Object.keys(this.items);
            if (paths.length > 0) {
                this.setPrimaryItem((this.items[paths[0]]).item);
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
        for each (path in Object.keys(this.items)) {
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
    _indicator = new IndicatorSensors;
    Main.panel.addToStatusArea('indicator-sensors', _indicator);
}

function disable() {
    // disconnect from dbus
    _indicator.destroy();
}
