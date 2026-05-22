(function() {
  var origFetch = window.fetch;
  var origXHROpen = XMLHttpRequest.prototype.open;
  var origXHRSend = XMLHttpRequest.prototype.send;

  function patchUrl(url) {
    if (url && url.indexOf('/getAllTasks') !== -1) {
      return url.replace(/pageSize=\d+/g, 'pageSize=1000');
    }
    return url;
  }

  function fixBody(body) {
    if (!body || !body.content) return body;
    if (body.content.pageSize !== 1000) return body;
    body.content.pageNum = 1;
    if (body.content.data && Array.isArray(body.content.data)) {
      body.content.total = body.content.data.length;
    }
    return body;
  }

  window.fetch = function(input, init) {
    var url = typeof input === 'string' ? input : (input && input.url);
    if (url && url.indexOf('/getAllTasks') !== -1) {
      var newUrl = url.replace(/pageSize=\d+/g, 'pageSize=1000');
      var p;
      if (typeof input === 'string') {
        p = origFetch.call(window, newUrl, init);
      } else {
        p = origFetch.call(window, new Request(newUrl, input), init);
      }
      return p.then(function(resp) {
        if (!resp.ok) return resp;
        var ct = (resp.headers.get('content-type') || '');
        if (ct.indexOf('json') === -1) return resp;
        return resp.clone().json().then(function(data) {
          fixBody(data);
          return new Response(JSON.stringify(data), {
            status: resp.status, statusText: resp.statusText, headers: resp.headers
          });
        }).catch(function() { return resp; });
      });
    }
    if (url && url.indexOf('/getAchievementDetail/fileList') !== -1 && init && init.body) {
      try {
        var b = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
        if (b && typeof b === 'object') { b.pageSize = 1000; init.body = JSON.stringify(b); }
      } catch(e) {}
    }
    return origFetch.call(window, input, init);
  };

  XMLHttpRequest.prototype.open = function(method, url, async, user, password) {
    this._yunguModified = !!(url && url.indexOf('/getAllTasks') !== -1);
    return origXHROpen.call(this, method, patchUrl(url), async, user, password);
  };

  XMLHttpRequest.prototype.send = function(body) {
    var xhr = this;
    if (xhr._yunguModified) {
      var origOnload = xhr.onload;
      xhr.addEventListener('load', function() {
        if (xhr.readyState !== 4 || xhr.status !== 200) return;
        try {
          var data = JSON.parse(xhr.responseText);
          fixBody(data);
          var str = JSON.stringify(data);
          Object.defineProperty(xhr, 'responseText', { value: str, configurable: true });
        } catch(e) {}
      });
    }
    return origXHRSend.call(this, body);
  };
})();
