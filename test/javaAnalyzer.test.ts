import { describe, expect, it } from 'vitest';
import { analyseJavaDocument, buildGraphForClass } from '../src/javaAnalyzer';

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

describe('analyseJavaDocument', () => {
  it('extracts the selected class name and outgoing class relationships', () => {
    const analysis = analyseJavaDocument('/workspace/src/UserService.java', userServiceSource);

    expect(analysis.className).toBe('UserService');
    expect(analysis.packageName).toBe('com.example');
    expect(analysis.outgoing).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ className: 'UserRepository', reasons: expect.arrayContaining(['field', 'parameter', 'variable']) }),
        expect.objectContaining({ className: 'AuditEvent', reasons: expect.arrayContaining(['instantiates', 'variable']) })
      ])
    );
  });

  it('ignores primitive and java.lang-style built-in names as graph relationships', () => {
    const analysis = analyseJavaDocument('/workspace/src/UserService.java', userServiceSource);

    expect(analysis.outgoing.map((edge) => edge.className)).not.toContain('String');
    expect(analysis.outgoing.map((edge) => edge.className)).not.toContain('Void');
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

    expect(graph.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'UserService', kind: 'selected', shape: 'rounded-rectangle', pinned: true, temporary: false }),
        expect.objectContaining({ id: 'AuditEvent', kind: 'outgoing', pinned: true, temporary: false }),
        expect.objectContaining({ id: 'UserRepository', kind: 'outgoing', pinned: false, temporary: true }),
        expect.objectContaining({ id: 'UserController', kind: 'incoming', pinned: false, temporary: true })
      ])
    );
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: 'UserService', to: 'AuditEvent' }),
        expect.objectContaining({ from: 'UserController', to: 'UserService', reasons: expect.arrayContaining(['instantiates']) })
      ])
    );
  });
});
