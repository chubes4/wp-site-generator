#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { parseArgs, readAgentRuntimeContract, readJsonFile, writeJsonFile } from './lib/ci-runtime-utils.mjs';

const args = parseArgs(process.argv.slice(2));
const repoRoot = path.resolve(args.get('--repo-root') || process.env.GITHUB_WORKSPACE || process.cwd());
const homeboyBin = args.get('--homeboy-bin') || process.env.HOMEBOY_BIN || 'homeboy';
const homeboyRunner = args.get('--homeboy-runner') || process.env.HOMEBOY_RUNNER || '';
const keepTemp = args.has('--keep-temp');
const tempDir = path.resolve(args.get('--work-dir') || await mkdtemp(path.join(tmpdir(), 'wpsg-headless-loop-')));
const runId = args.get('--run-id') || process.env.WPSG_REPLAY_ID || 'headless-contract';
const randomnessSeed = args.get('--randomness-seed') || process.env.WPSG_RANDOMNESS_SEED || 'headless-contract-seed';
const runtimeContract = readAgentRuntimeContract(process.env);
const runtimeId = args.get('--runtime-id') || process.env.HOMEBOY_AGENT_RUNTIME || runtimeContract.provider || runtimeContract.profile;
const writeFixtureArtifacts = args.has('--fixture-artifacts');
const artifactRoot = path.resolve(args.get('--artifact-root') || path.join(tempDir, 'homeboy-agent-task-artifacts'));
const evidencePath = path.resolve(args.get('--evidence') || path.join(tempDir, 'headless-site-generation-loop-evidence.json'));

const controllerSpecPath = '.github/homeboy/controllers/static-site-generation-loop.controller.json';
const controllerRunInputsPath = path.join(tempDir, 'site-generation-loop.controller-run-inputs.json');
const policyResultPath = path.join(tempDir, 'site-generation-loop.complexity-policy-result.json');
const materializationPath = path.join(tempDir, 'site-generation-loop.controller-materialization.json');
const materializationProofPath = path.join(tempDir, 'site-generation-loop.controller-materialization.proof.json');
const controllerRunSpecPath = path.join(tempDir, 'site-generation-loop.controller-run-spec.json');
const controllerResultPath = path.join(tempDir, 'site-generation-loop.controller-run-from-spec.json');
const controllerStdoutPath = path.join(tempDir, 'site-generation-loop.controller-run-from-spec.stdout.log');
const maxStdoutJsonBytes = 1024 * 1024;

const commandEvidence = [];

function run(label, command, commandArgs, options = {}) {
	commandEvidence.push({ label, command: [command, ...commandArgs].join(' '), ...(options.evidence || {}) });
	let stdoutFd = null;
	try {
		if (options.stdoutPath) {
			stdoutFd = openSync(options.stdoutPath, 'w');
		}
		const result = spawnSync(command, commandArgs, {
			cwd: repoRoot,
			encoding: 'utf8',
			env: { ...process.env, ...options.env },
			stdio: options.stdoutPath ? ['ignore', stdoutFd, 'pipe'] : ['ignore', 'pipe', 'pipe'],
		});
		result.stdoutPath = options.stdoutPath || '';
		const stdout = options.stdoutPath ? `[captured at ${options.stdoutPath}]` : result.stdout;
		assert.equal(result.status, 0, `${label} failed\nstdout:\n${stdout}\nstderr:\n${result.stderr}`);
		return result;
	} finally {
		if (stdoutFd !== null) {
			closeSync(stdoutFd);
		}
	}
}

function homeboyArgs(commandArgs) {
	return homeboyRunner ? ['--runner', homeboyRunner, ...commandArgs] : commandArgs;
}

async function readRunFromSpecResult(result, outputPath) {
	try {
		return await readJsonFile(outputPath);
	} catch (error) {
		if (error?.code !== 'ENOENT') {
			throw error;
		}
	}

	let stdout = result.stdout || '';
	if (result.stdoutPath) {
		const stdoutStat = await stat(result.stdoutPath);
		assert.ok(stdoutStat.size <= maxStdoutJsonBytes, `Homeboy from-spec did not write structured output to ${outputPath} and stdout exceeded the bounded JSON fallback (${maxStdoutJsonBytes} bytes)`);
		stdout = await readFile(result.stdoutPath, 'utf8');
	}
	assert.ok(stdout.length > 0, `Homeboy from-spec did not write structured output to ${outputPath} and stdout was empty`);
	assert.ok(Buffer.byteLength(stdout, 'utf8') <= maxStdoutJsonBytes, `Homeboy from-spec did not write structured output to ${outputPath} and stdout exceeded the bounded JSON fallback (${maxStdoutJsonBytes} bytes)`);
	const parsed = JSON.parse(stdout);
	await writeJsonFile(outputPath, parsed);
	return parsed;
}

function assertBackendNeutralController(controllerRunSpec) {
	assert.equal(controllerRunSpec.runtime, undefined, 'controller run spec does not embed a runtime backend');
	assert.equal(controllerRunSpec.backend, undefined, 'controller run spec does not embed a backend selector');
	assert.equal(controllerRunSpec.provider, undefined, 'controller run spec does not embed a provider selector');
	assert.ok(controllerRunSpec.workflows?.every((workflow) => workflow.inputs?.runtime_input_contract === 'homeboy-agent-runtime-env'), 'materialized workflows use the generic Homeboy agent runtime env contract');
	assert.ok(controllerRunSpec.workflows?.every((workflow) => workflow.inputs?.runtime_config?.source === 'homeboy-agent-runtime-env'), 'materialized workflows carry the generic runtime config');
}

try {
	if (writeFixtureArtifacts) {
		throw new Error('--fixture-artifacts is disabled for headless validation; provide --artifact-root with Homeboy-emitted artifacts');
	}
	await mkdir(tempDir, { recursive: true });
	const baseEnv = {
		GITHUB_WORKSPACE: repoRoot,
		GITHUB_REPOSITORY: 'chubes4/wp-site-generator',
		WPSG_REPLAY_ID: runId,
		WPSG_RANDOMNESS_SEED: randomnessSeed,
		HOMEBOY_AGENT_RUNTIME: runtimeId,
		HOMEBOY_CONTROLLER_SPEC_PATH: controllerSpecPath,
		HOMEBOY_CONTROLLER_RUN_INPUTS_PATH: controllerRunInputsPath,
		HOMEBOY_POLICY_RESULT_PATH: policyResultPath,
		HOMEBOY_ARTIFACT_ROOT: artifactRoot,
	};

	run('build WPSG controller run inputs', process.execPath, ['.github/scripts/build-homeboy-controller-run-inputs.mjs'], { env: baseEnv });
	const runFromSpecResult = run('run Homeboy controller from spec', homeboyBin, homeboyArgs(['agent-task', 'controller', 'from-spec', `@${controllerSpecPath}`, '--resume', '--inputs', `@${controllerRunInputsPath}`, '--policy-result', `@${policyResultPath}`, '--max-actions', '100', '--output', controllerResultPath]), {
		env: baseEnv,
		stdoutPath: controllerStdoutPath,
		evidence: {
			homeboy_runner: homeboyRunner,
			output_path: controllerResultPath,
			stdout_path: controllerStdoutPath,
			artifact_root: artifactRoot,
		},
	});
	const controllerResult = await readRunFromSpecResult(runFromSpecResult, controllerResultPath);
	await writeJsonFile(materializationPath, controllerResult.materialization || controllerResult.data?.materialization || controllerResult.value?.materialization);
	const materialization = await readJsonFile(materializationPath);
	await writeJsonFile(materializationProofPath, materialization.data || materialization.value || materialization);
	run('validate materialized Homeboy proof', homeboyBin, homeboyArgs(['agent-task', 'controller', 'validate-proof', `@${materializationProofPath}`]), { env: baseEnv });
	run('write run-scoped controller spec', process.execPath, ['.github/scripts/write-materialized-controller-run-spec.mjs', materializationPath, controllerRunSpecPath], { env: baseEnv });

	run('assert WPSG semantic artifact proof', process.execPath, ['.github/scripts/assert-site-generation-loop-proof.mjs', '--controller-result', controllerResultPath, '--controller-run-spec', controllerRunSpecPath, '--artifact-root', artifactRoot], { env: baseEnv });

	const controllerRunSpec = await readJsonFile(controllerRunSpecPath);
	const runInputs = await readJsonFile(controllerRunInputsPath);
	assertBackendNeutralController(controllerRunSpec);
	assert.equal(runInputs.inputs.runtime_input_contract, 'homeboy-agent-runtime-env', 'run inputs expose the generic runtime input contract');

	await writeJsonFile(evidencePath, {
		schema: 'wp-site-generator/headless-site-generation-loop-validation/v1',
		valid: true,
		run_id: runId,
		runtime_input_contract: runInputs.inputs.runtime_input_contract,
		runtime_id: runtimeId,
		fixture_artifacts: writeFixtureArtifacts,
		artifact_source: writeFixtureArtifacts ? 'legacy-debug-fixture' : 'homeboy-emitted',
		paths: {
			controller_run_inputs: controllerRunInputsPath,
			policy_result: policyResultPath,
			materialization: materializationPath,
			controller_run_spec: controllerRunSpecPath,
			controller_result: controllerResultPath,
			artifact_root: artifactRoot,
		},
		commands: commandEvidence,
		upstream_dependencies: [
			'https://github.com/Extra-Chill/homeboy/pull/5152',
			'https://github.com/Extra-Chill/homeboy/pull/5186',
			'https://github.com/Extra-Chill/homeboy-extensions/pull/1644',
			'https://github.com/Extra-Chill/homeboy-extensions/pull/1645',
			'https://github.com/Extra-Chill/homeboy-extensions/pull/1646',
		],
	});

	console.log(`Headless site generation loop contract passed: ${evidencePath}`);
} finally {
	if (!keepTemp && !args.has('--work-dir')) {
		await rm(tempDir, { recursive: true, force: true });
	}
}
