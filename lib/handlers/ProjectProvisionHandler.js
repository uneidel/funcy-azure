'use strict';

const chalk = require('chalk'),
	os = require('os'),
	merge = require('merge'),
	Spinner = require('cli-spinner').Spinner,
	msRestAzure = require('ms-rest-azure'),
	ResourceManagementClient = require('azure-arm-resource').ResourceManagementClient,
	BbPromise = require('bluebird'),
	path = require('path'),
	fs = BbPromise.promisifyAll(require("fs-extra")),
	FError = require('./../Error'),
	env = require('./../utils/env'),
	project = require('./../utils/project');

class ProjectProvisionHandler {
	constructor() {
		this.context = 'project';
		this.action = 'provision';
	}
	
	process(options) {
		return BbPromise.try(() => {
			if (!this._checkOptions(options)) {
				throw new FError('resource group and/or location has not been specified.');
			}

			let resourceGroup = options.g || options.resourceGroup;
			let location = options.l || options.location;
			let serverFarm = options.s || options.serverFarm; 
			let deploymentName = options.d || options.deploymentName || 'FAZDeployment-' + Date.now();
			let deploymentParameters = {
				properties: {
					mode: 'Incremental',
					parameters: {
						siteLocation: {
							value: location
						},
						fazProjectName: {
							value: project.name
						},
						serverfarmsName: {
							value: serverFarm
						}
					}
				}
			}
			this._modDeploymentParams(deploymentParameters);

			console.log(chalk.cyan('Starting provisioning / updating your project... (this will take up to ~3 mins)' + os.EOL));
			
			const avp = env.getAdminVars();
			return avp.then((creds) => {
				let credentials = new msRestAzure.ApplicationTokenCredentials(creds.app_id, creds.tenant_id, creds.password);
				let client = new ResourceManagementClient(credentials, creds.subscription_id);
				client.deployments = BbPromise.promisifyAll(client.deployments);
				client.resourceGroups = BbPromise.promisifyAll(client.resourceGroups);
				let spinner = new Spinner(chalk.cyan('Updating ARM template... %s'));
				spinner.setSpinnerString('|/-\\');
				spinner.start();
				this._updateARMTemplate()
					.then(() => {
						let armTemplate = require(env.ARMTemplate);
						deploymentParameters.properties.template = armTemplate;				
						// Validation
						spinner.stop();
						spinner = new Spinner(chalk.cyan('Validating ARM template... %s'));
						spinner.setSpinnerString('|/-\\');
						spinner.start();
						return client.deployments.validateAsync(resourceGroup, deploymentName, deploymentParameters)
					})
					.then(() => {
						// Create/Update Resource Group
						spinner.stop();
						console.log(chalk.green('DONE!'));
						spinner = new Spinner(chalk.cyan('Creating/Updating Resource Group... %s'));
						spinner.setSpinnerString('|/-\\');
						spinner.start();
						return client.resourceGroups.createOrUpdateAsync(resourceGroup, { location: location });
					})
					.then(() => {
						// Provision template
						spinner.stop();
						console.log(chalk.green('DONE!'));
						spinner = new Spinner(chalk.cyan('Executing ARM template... %s'));
						spinner.setSpinnerString('|/-\\');
						spinner.start();
						return client.deployments.createOrUpdateAsync(resourceGroup, deploymentName, deploymentParameters);
					})
					.then((res) => {
						spinner.stop();
						console.log(chalk.green('DONE!'));
						console.log(chalk.cyan('******************************************************************'))
						console.log(chalk.cyan('All good. Your project has been successfully provisioned to Azure.'))
						// TODO: Write res to faz.log	
					})
					.catch((e) => {
						spinner.stop();
						console.log(chalk.red('FAILED!'));
						console.log(chalk.red('Ups. Something went wrong. See error message for details.'));
						throw new FError('Unable to provision project: ' + e.message);
				});
			})
		});
	}
	
	/**
	 * Adds additional deployment parameters stored in f-project.json
	 */
	_modDeploymentParams(params) {
		params.properties.parameters.repoUrl = {
			value: project.versionControl.location
		}
	}
	
	_checkOptions(options) {
		return !((options.g === undefined && options.resourceGroup === undefined) ||
			(options.l === undefined && options.location === undefined));
	}

	/**
	 * Merges cloud.env variables with template 
	 */
	_updateARMTemplate() {
		return env.getCloudVars()
			.then((cloudVars) => {
				let template = require(env.ARMTemplate);
				template.resources.forEach((r) => {
					if (r.type === 'Microsoft.Web/sites') {
						merge.recursive(r.resources[0].properties, cloudVars);
					}
				});
				fs.writeFileAsync(env.ARMTemplate, JSON.stringify(template, null, 2));
			})
			.catch((e) => {
				throw new FError('Unable to update ARM template with environment variables. Aborting: ' + JSON.stringify(e));;
			});
	}

	help() {
		let help = 'Provisions or updates the current state of your project to your Azure subscription.' + os.EOL + os.EOL;
		help += '-g, --resourceGroup' + os.EOL;
		help += '      The resource group where this project is to be provisioned or updated.' + os.EOL;
		help += '-l, --location' + os.EOL;
		help += '      The location where this project is to be provisioned or updated.' + os.EOL;
		help += '-s, --serverFarm' + os.EOL;
		help += '     The name of the Server Farm aka App Plan (Dynamic Tier only) you want to create or re-use.' + os.EOL;
		help += '-d, --deploymentName' + os.EOL;
		help += '      Optional - Set a dedicated deployment name. Default: <projectname>' + os.EOL;

		console.log(chalk.cyan(help));
	}
}

module.exports = ProjectProvisionHandler;