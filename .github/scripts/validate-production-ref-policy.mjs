#!/usr/bin/env node

import { resolveImmutableSourceRef, validateRefPolicy } from './lib/site-generation-loop-run.mjs';
import { wpsgLoopConfig } from './lib/wpsg-domain-config.mjs';

const dependencyRefs = {
	homeboy: {
		id: 'homeboy',
		input_ref: process.env.HOMEBOY_REF || '',
		ref_type: 'workflow-input-ref',
	},
	homeboy_extensions: {
		id: 'homeboy_extensions',
		input_ref: process.env.HOMEBOY_EXTENSIONS_REF || '',
		ref_type: 'workflow-input-ref',
	},
};

validateRefPolicy({
	policy: process.env.WPSG_REF_POLICY || wpsgLoopConfig.defaultRefPolicy,
	dependencyRefs,
	source: resolveImmutableSourceRef({ env: process.env }),
});

console.log('WPSG ref policy passed');
