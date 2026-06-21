#!/usr/bin/env node
import { readJsonFile, writeJsonFile } from './lib/ci-runtime-utils.mjs';
import { buildSiteGenerationLoopId } from './lib/site-generation-loop-run.mjs';

const [materializationPath, outputPath] = process.argv.slice(2);

if (!materializationPath || !outputPath) {
	throw new Error('Usage: write-materialized-controller-run-spec.mjs <materialization.json> <controller-run-spec.json>');
}

const materializationEnvelope = await readJsonFile(materializationPath);
const materialization = materializationEnvelope.data || materializationEnvelope.value || materializationEnvelope;
const spec = materialization.spec;

if (!spec) {
	throw new Error('Materialization result does not contain a controller spec.');
}

const runId = spec.metadata?.run?.run_id || spec.workflows?.find((workflow) => workflow.inputs?.run_id)?.inputs?.run_id;
const loopId = buildSiteGenerationLoopId(runId);

spec.loop_id = loopId;
spec.metadata = {
	...(spec.metadata || {}),
	run: {
		...(spec.metadata?.run || {}),
		loop_id: loopId,
	},
};

await writeJsonFile(outputPath, spec);
