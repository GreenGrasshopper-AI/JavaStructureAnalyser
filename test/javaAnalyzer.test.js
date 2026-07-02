const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { analyseJavaDocument, buildGraphForClass } = require('../dist/javaAnalyzer');

const userServiceSource = `
package com.example;

import com.example.repository.UserRepository;
import com.example.events.AuditEvent;

public class UserService {
  private final UserRepository repository;

  public UserService(UserRepository repository) {
    this.repository = repository;
  }

  public void createUser() {
    UserRepository localRepository = repository;
    AuditEvent event = new AuditEvent();
    localRepository.save(event.toString());
  }
}
`;

const controllerSource = `
package com.example.web;

import com.example.UserService;

public class UserController {
  public void handle() {
    UserService service = new UserService(null);
    service.createUser();
  }
}
`;

function assertIncludesRelationship(relationships, className, reasons) {
  const relationship = relationships.find((candidate) => candidate.className === className);
  assert.ok(relationship, `Expected relationship for ${className}`);

  for (const reason of reasons) {
    assert.ok(
      relationship.reasons.includes(reason),
      `Expected ${className} to include reason ${reason}; got ${relationship.reasons.join(', ')}`
    );
  }
}

function assertIncludesNode(nodes, expected) {
  const node = nodes.find((candidate) => candidate.id === expected.id);
  assert.ok(node, `Expected node ${expected.id}`);

  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(node[key], value, `Expected node ${expected.id} to have ${key}=${value}`);
  }
}

function assertIncludesEdge(edges, expected) {
  const edge = edges.find((candidate) => candidate.from === expected.from && candidate.to === expected.to);
  assert.ok(edge, `Expected edge ${expected.from} -> ${expected.to}`);

  if (expected.reasons) {
    for (const reason of expected.reasons) {
      assert.ok(
        edge.reasons.includes(reason),
        `Expected edge ${expected.from} -> ${expected.to} to include reason ${reason}; got ${edge.reasons.join(', ')}`
      );
    }
  }
}

describe('analyseJavaDocument', () => {
  it('extracts the selected class name and outgoing class relationships', () => {
    const analysis = analyseJavaDocument('/workspace/src/UserService.java', userServiceSource);

    assert.equal(analysis.className, 'UserService');
    assert.equal(analysis.packageName, 'com.example');
    assertIncludesRelationship(analysis.outgoing, 'UserRepository', ['field', 'parameter', 'variable']);
    assertIncludesRelationship(analysis.outgoing, 'AuditEvent', ['instantiates', 'variable']);
  });

  it('ignores primitive and java.lang-style built-in names as graph relationships', () => {
    const analysis = analyseJavaDocument('/workspace/src/UserService.java', userServiceSource);
    const outgoingClassNames = analysis.outgoing.map((edge) => edge.className);

    assert.ok(!outgoingClassNames.includes('String'));
    assert.ok(!outgoingClassNames.includes('Void'));
  });
});

describe('buildGraphForClass', () => {
  it('builds a graph with a rounded selected node, outgoing temporary nodes, and incoming creator nodes', () => {
    const current = analyseJavaDocument('/workspace/src/UserService.java', userServiceSource);
    const allDocuments = [
      current,
      analyseJavaDocument('/workspace/src/UserController.java', controllerSource)
    ];

    const graph = buildGraphForClass(current, allDocuments, new Set(['AuditEvent']));

    assertIncludesNode(graph.nodes, {
      id: 'UserService',
      kind: 'selected',
      shape: 'rounded-rectangle',
      pinned: true,
      temporary: false
    });
    assertIncludesNode(graph.nodes, {
      id: 'AuditEvent',
      kind: 'outgoing',
      pinned: true,
      temporary: false
    });
    assertIncludesNode(graph.nodes, {
      id: 'UserRepository',
      kind: 'outgoing',
      pinned: false,
      temporary: true
    });
    assertIncludesNode(graph.nodes, {
      id: 'UserController',
      kind: 'incoming',
      pinned: false,
      temporary: true
    });
    assertIncludesEdge(graph.edges, { from: 'UserService', to: 'AuditEvent' });
    assertIncludesEdge(graph.edges, { from: 'UserController', to: 'UserService', reasons: ['instantiates'] });
  });
});
