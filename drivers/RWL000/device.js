'use strict';

const { ZigBeeDevice } = require('homey-zigbeedriver');
const { Cluster, CLUSTER } = require('zigbee-clusters');
const OnOffBoundCluster = require('../../lib/OnOffBoundCluster');
const LevelControlBoundCluster = require('../../lib/LevelControlBoundCluster');
const HueSpecificBasicCluster = require('../../lib/HueSpecificBasicCluster');

Cluster.addCluster(HueSpecificBasicCluster);

class DimmerSwitch extends ZigBeeDevice {

async onNodeInit({ zclNode }) {

  this.printNode();

  const batteryEndpointId = 2;

  // Buttons
  zclNode.endpoints[1].bind(CLUSTER.ON_OFF.NAME, new OnOffBoundCluster({
    onSetOn: this._onCommandParser.bind(this),
    onSetOff: this._offCommandParser.bind(this),
    offWithEffect: this._offCommandParser.bind(this)
  }));

  zclNode.endpoints[1].bind(CLUSTER.LEVEL_CONTROL.NAME, new LevelControlBoundCluster({
    onStep: this._stepCommandParser.bind(this),
    onStepWithOnOff: this._stepCommandParser.bind(this),
    onStop: this._stopCommandParser.bind(this),
    onStopWithOnOff: this._stopCommandParser.bind(this),
  }));

  this._switchOnTriggerDevice = this.homey.flow.getDeviceTriggerCard('RWL000_on');
  this._switchOffTriggerDevice = this.homey.flow.getDeviceTriggerCard('RWL000_off');
  this._switchDimTriggerDevice = this.homey.flow.getDeviceTriggerCard('RWL000_dim')
    .registerRunListener(async (args, state) => {
      return (null, args.action === state.action);
    });

  await this._configureBattery(zclNode, batteryEndpointId);

  }

  async _configureBattery(zclNode, endpointId) {
    const isFirstInit = this.isFirstInit();
    const endpoint = zclNode.endpoints[endpointId];
    if (!endpoint || !endpoint.clusters[CLUSTER.POWER_CONFIGURATION.NAME]) {
      this.error(`Power configuration cluster not found on endpoint ${endpointId}`);
      return;
    }

    if (isFirstInit && endpoint.clusters.HueSpecificBasicCluster) {
      try {
        await endpoint.clusters.HueSpecificBasicCluster.writeAttributes(
          { philips: 0x000b },
          { manufacturerCode: 0x100b, disableDefaultResponse: true },
        );
      } catch (err) {
        this.error('Error writing Hue specific Basic attribute (0x0031)', err);
      }
    }

    if (!this.hasCapability('measure_battery')) {
      await this.addCapability('measure_battery');
    }

    const batteryReportOpts = {
      configureAttributeReporting: {
        minInterval: 0,
        maxInterval: 21600,
        minChange: 1,
      },
    };

    this.registerCapability('measure_battery', CLUSTER.POWER_CONFIGURATION, {
      endpoint: endpointId,
      getOpts: {
        getOnStart: true,
        getOnOnline: true,
      },
      reportOpts: batteryReportOpts,
    });

    this.batteryThreshold = 20;
    this.registerCapability('alarm_battery', CLUSTER.POWER_CONFIGURATION, {
      endpoint: endpointId,
      getOpts: {
        getOnStart: true,
        getOnOnline: true,
      },
    });
  }

  _onCommandParser() {
    return this._switchOnTriggerDevice.trigger(this, {}, {})
      .then(() => this.log('triggered RWL000_on'))
      .catch(err => this.error('Error triggering RWL000_on', err));
  }

  _offCommandParser() {
    return this._switchOffTriggerDevice.trigger(this, {}, {})
      .then(() => this.log('triggered RWL000_off'))
      .catch(err => this.error('Error triggering RWL000_off', err));
  }

  _stepCommandParser(payload) {
    var action = payload.stepSize === 30 ? 'press' : 'hold'; // 30=press,56=hold
    return this._switchDimTriggerDevice.trigger(this, {}, { action: `${payload.mode}-${action}` })
      .then(() => this.log(`triggered RWL000_dim, action=${payload.mode}-${action}`))
      .catch(err => this.error('Error triggering RWL000_dim', err));
  }

  _stopCommandParser() {
    return this._switchDimTriggerDevice.trigger(this, {}, { action: 'release' })
    .then(() => this.log('triggered RWL000_dim, action=release'))
    .catch(err => this.error('Error triggering RWL000_dim', err));
  }

}

module.exports = DimmerSwitch;
