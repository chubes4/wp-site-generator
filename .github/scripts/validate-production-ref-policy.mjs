#!/usr/bin/env node

import { resolveImmutableSourceRef, validateRefPolicy } from './lib/site-generation-loop-run.mjs';
import { wpsgLoopConfig } from './lib/wpsg-domain-config.mjs';

validateRefPolicy({
	policy: process.env.WPSG_REF_POLICY || wpsgLoopConfig.defaultRefPolicy,
	dependencyRefs: {},
	source: resolveImmutableSourceRef({ env: process.env }),
});

console.log('WPSG ref policy passed');
